/**
 * This phone's notifications (ADR 0006), from every instance it is signed in to (ADR 0007).
 *
 * The phone registers its device token with each of its instances; an instance asks the publisher's
 * relay to wake it, with a constant push and never any content, which does not even say which
 * instance woke it; the phone then asks each instance what to show (the hub's `GET /api/v1/me/push/pending`):
 *
 * - on iOS, the Notification Service Extension (`targets/notifications`) does, before the alert is
 *   shown;
 * - on Android, the background task of `push/background.ts` does, and draws local notifications.
 *
 * Both need the instances' addresses and session tokens while the app itself is not running, so a
 * copy is kept apart (`SHARED`): in the keychain group shared with the extensions on iOS (the
 * notification service and the widgets), readable after the first unlock so a notification can be
 * read while the phone is locked. It is written whenever the signed-in instances change, and an
 * instance leaves it when the phone signs out of it.
 *
 * Expo Go cannot receive pushes for this app: there, notifications are unavailable.
 */
import type { Instance } from "@ruchoir/native-client";

import { native } from "../products/auth.ts";
import type { RuchoirClient } from "../products/index.ts";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

import { notifications } from "./native";
import { registrationTargets, requireNoPreview } from "./previewGuard";
import { parseSharedAccounts, serializeSharedAccounts, type SharedAccount, type SharedProduct } from "./shared";

/** Where the extensions and the background task read the instances and their tokens. */
export const SHARED: SecureStore.SecureStoreOptions = {
  keychainService: "ruchoir.push",
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};
/** Every signed-in instance, as `[{ server, token }]` (`push/shared.ts`). */
export const SHARED_ACCOUNTS = "push.accounts";
/** The device token last registered, to forget it at sign-out. */
const DEVICE = "ruchoir.pushDevice";
/** Android's channel for messages and mentions. */
export const CHANNEL = "messages";

export type PhonePush = "on" | "off" | "denied" | "unavailable";

/** Whether this phone receives notifications, may be asked, or was refused by its owner. */
export async function phonePushState(): Promise<PhonePush> {
  const Notifications = notifications();
  if (!Notifications) return "unavailable";
  const { status } = await Notifications.getPermissionsAsync();
  if (status === "denied") return "denied";
  return status === "granted" && (await SecureStore.getItemAsync(DEVICE)) ? "on" : "off";
}

/**
 * Hand the extensions (notifications, widgets) every signed-in instance: its hub with a hub access
 * token, and the calendar and the chat with theirs only when the manifest lists them (the widgets
 * follow the manifest). Only access tokens leave the app, never the refresh token (which stays in
 * the native client's own keychain items): they are short-lived, so the app writes them again when
 * it comes back to the foreground and from its background task (`push/refresh.ts`), and an
 * extension that finds one expired shows what it last drew.
 *
 * An instance whose tokens could not be had this time (offline, the phone locked) keeps the entry it
 * had, so a failed refresh never takes it off the home screen; one the app no longer holds leaves.
 */
export async function shareSessions(instances: { instance: Instance }[]): Promise<void> {
  const before = parseSharedAccounts(await SecureStore.getItemAsync(SHARED_ACCOUNTS, SHARED).catch(() => null));
  const accounts = (
    await Promise.all(
      instances.map(async ({ instance }): Promise<SharedAccount | null> => {
        const url = (name: string) => instance.products.find((p) => p.name === name && p.description !== null)?.url;
        const product = async (name: string): Promise<SharedProduct | undefined> => {
          const at = url(name);
          if (!at) return undefined;
          const token = await native.accessToken(instance.issuer, at).catch(() => null);
          return token ? { url: at, token } : undefined;
        };
        const hub = await product("hub");
        if (!hub) return before.find((a) => a.server === url("hub")) ?? null;
        const [calendar, chat] = await Promise.all([product("calendar"), product("chat")]);
        return { server: hub.url, token: hub.token, ...(calendar ? { calendar } : {}), ...(chat ? { chat } : {}) };
      }),
    )
  ).filter((a): a is SharedAccount => a !== null);
  if (accounts.length === 0) await SecureStore.deleteItemAsync(SHARED_ACCOUNTS, SHARED).catch(() => {});
  else await SecureStore.setItemAsync(SHARED_ACCOUNTS, serializeSharedAccounts(accounts), SHARED);
}

/** The device token, once the system granted notifications; null otherwise (never asks). */
async function deviceToken(): Promise<string | null> {
  const Notifications = notifications();
  if (!Notifications) return null;
  const { status } = await Notifications.getPermissionsAsync();
  if (status !== "granted") return null;
  return String((await Notifications.getDevicePushTokenAsync()).data);
}

/** Whether an instance's client is looking at a role (it then drops background writes, and the server refuses the rest). */
const previewing = (client: RuchoirClient) => client.options().previewActive?.() === true;

const platform = () => (Platform.OS === "ios" ? "ios" : "android");

/**
 * Turn notifications on for this phone: ask the system when `ask` (never at launch), then register
 * the device with every signed-in instance.
 */
export async function enablePhonePush(ask: boolean, clients: RuchoirClient[]): Promise<PhonePush> {
  const Notifications = notifications();
  if (!Notifications) return "unavailable";
  // A previewing instance would drop the registration without saying so: refused when the person
  // asked (`PreviewBlocked`), left out at launch.
  const targets = registrationTargets(clients, previewing, ask);
  let { status } = await Notifications.getPermissionsAsync();
  if (status !== "granted" && ask) ({ status } = await Notifications.requestPermissionsAsync());
  if (status !== "granted") return status === "denied" ? "denied" : "off";
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync(CHANNEL, {
      name: "Ruchoir",
      importance: Notifications.AndroidImportance.HIGH,
    });
  }
  const device = await deviceToken();
  if (!device) return "off";
  // One instance that does not answer does not keep the others from notifying.
  const results = await Promise.allSettled(targets.map((client) => client.registerPushDevice(platform(), device)));
  if (targets.length > 0 && results.every((r) => r.status === "rejected")) throw (results[0] as PromiseRejectedResult).reason;
  // Nothing was sent (every instance previews): the phone is not registered, and does not say so.
  if (targets.length === 0 && clients.length > 0) return phonePushState();
  await SecureStore.setItemAsync(DEVICE, device);
  return "on";
}

/**
 * At every start signed in, and when an instance is added: register a phone whose notifications are
 * on again with these instances, which also moves each to the account now signed in there. Never asks.
 */
export async function refreshPhonePush(clients: RuchoirClient[]): Promise<void> {
  if ((await phonePushState()) !== "on") return;
  await enablePhonePush(false, clients).catch(() => {});
}

/** Signing out of one instance: it forgets this phone, while the session still opens its door. */
export async function forgetPhoneOn(client: RuchoirClient): Promise<void> {
  const device = await SecureStore.getItemAsync(DEVICE).catch(() => null);
  if (device) await client.forgetPushDevice(device).catch(() => {});
}

/** Turn notifications off for this phone: every instance forgets it (refused while one previews). */
export async function disablePhonePush(clients: RuchoirClient[]): Promise<void> {
  requireNoPreview(clients, previewing);
  const device = await SecureStore.getItemAsync(DEVICE).catch(() => null);
  if (device) await Promise.all(clients.map((client) => client.forgetPushDevice(device).catch(() => {})));
  await SecureStore.deleteItemAsync(DEVICE).catch(() => {});
}
