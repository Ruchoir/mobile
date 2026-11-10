/**
 * Signing in with an instance's Propolis, through `@ruchoir/native-client` (RFC 8252).
 *
 * The phone opens Propolis's sign-in in the authentication browser (`ASWebAuthenticationSession`
 * on iOS, Custom Tabs on Android), which comes back on the app's private scheme
 * (`com.ruchoir.app:/oauth/callback`). The client checks `state` and `iss`, trades the code with
 * its PKCE verifier, keeps one refresh token per issuer in the Keychain and hands one access token
 * per product (`resource`), held in memory only. Passkeys and the second factor happen on
 * Propolis's own pages, in that browser.
 */
import { NativeClient, type Platform, type SecureStorage } from "@ruchoir/native-client";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import * as WebBrowser from "expo-web-browser";

/** The app's client id at Propolis. */
export const CLIENT_ID = "ruchoir-mobile";
/** Where Propolis sends the browser back: the app's private scheme (RFC 8252, section 7.1). */
export const REDIRECT_URI = "com.ruchoir.app:/oauth/callback";

const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

/** The Keychain, readable only while the phone is unlocked and never copied to a backup. */
const storage: SecureStorage = {
  get: (key) => SecureStore.getItemAsync(key, OPTIONS),
  set: (key, value) => SecureStore.setItemAsync(key, value, OPTIONS),
  delete: (key) => SecureStore.deleteItemAsync(key, OPTIONS),
};

/** The phone's side of the native client: fetch, the authentication browser, the Keychain, crypto. */
export const expoPlatform: Platform = {
  fetch: (url, init) => fetch(url, init),
  async authorize(url, redirectUri) {
    // Nothing of this browsing is kept: a passkey lives in the phone's keychain, not in cookies.
    const result = await WebBrowser.openAuthSessionAsync(url, redirectUri, { preferEphemeralSession: true });
    if (result.type !== "success") throw new Error("the sign-in browser was closed");
    return result.url;
  },
  storage,
  randomBytes: (length) => Crypto.getRandomBytes(length),
  sha256: async (data) =>
    new Uint8Array(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, data as unknown as BufferSource)),
};

/** The one native client of the app: every instance's grant goes through it. */
export const native = new NativeClient({
  platform: expoPlatform,
  clientId: CLIENT_ID,
  redirectUri: REDIRECT_URI,
});

/**
 * Open one of Propolis's pages (the account, an organisation's members, roles, groups,
 * invitations) in the authentication browser, where the person's Propolis session lives. The app
 * keeps no screen of its own for them (organisation and account management belong to Propolis).
 */
export async function openPropolisPage(issuer: string, path: string): Promise<void> {
  await WebBrowser.openBrowserAsync(`${issuer.replace(/\/+$/, "")}${path}`);
}
