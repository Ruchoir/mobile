/**
 * What the phone keeps between launches about its instances (ADR 0002): the registry (which
 * instances, which is open, the last space of each, what each one's discovery found).
 *
 * It lives in the Keychain (Android: the Keystore), readable only while the phone is unlocked and
 * never copied into a backup or to another device (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`). It holds no
 * secret: the grants are the native client's, one refresh token per issuer (`products/auth.ts`).
 */
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";

import { EMPTY_REGISTRY, parseRegistry, type Registry } from "./registry";

const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};
// A new key: the monolith's registry named servers, not domains, and is not read (no migration).
const REGISTRY = "ruchoir.instances.v2";

/** A new instance's id: random, and only letters and digits, as a Keychain key requires. */
export function newInstanceId(): string {
  return Array.from(Crypto.getRandomBytes(8), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function saveRegistry(registry: Registry): Promise<void> {
  await SecureStore.setItemAsync(REGISTRY, JSON.stringify(registry), OPTIONS);
}

export async function loadRegistry(): Promise<Registry> {
  const stored = await SecureStore.getItemAsync(REGISTRY, OPTIONS);
  return stored === null ? EMPTY_REGISTRY : parseRegistry(stored);
}
