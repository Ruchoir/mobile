/**
 * The list of signed-in instances the app hands its extensions (ADR 0007): the iPhone's notification
 * service and widgets read it in Swift, Android's background task and widgets here. Free of the
 * native modules so Node tests it.
 */

/** A product of the instance the extensions ask: its origin and an access token for it. */
export type SharedProduct = { url: string; token: string };

/**
 * One signed-in instance, as the extensions need it: its hub (`server`, `token`: the inbox and the
 * pending pushes) and, when the manifest lists them, the calendar and the chat (the widgets).
 */
export type SharedAccount = { server: string; token: string; calendar?: SharedProduct; chat?: SharedProduct };

const isProduct = (p: unknown): p is SharedProduct =>
  typeof (p as SharedProduct)?.url === "string" && typeof (p as SharedProduct)?.token === "string" && (p as SharedProduct).url.startsWith("https://");

export function serializeSharedAccounts(accounts: SharedAccount[]): string {
  return JSON.stringify(accounts.map(({ server, token, calendar, chat }) => ({ server, token, calendar, chat })));
}

/** The list read back; an entry that is not a pair of strings is left out, a damaged list is empty. */
export function parseSharedAccounts(json: string | null): SharedAccount[] {
  if (!json) return [];
  try {
    const value: unknown = JSON.parse(json);
    if (!Array.isArray(value)) return [];
    return value
      .filter((e): e is SharedAccount => typeof e?.server === "string" && typeof e?.token === "string" && e.server.startsWith("https://"))
      .map(({ server, token, calendar, chat }) => ({
        server,
        token,
        ...(isProduct(calendar) ? { calendar } : {}),
        ...(isProduct(chat) ? { chat } : {}),
      }));
  } catch {
    return [];
  }
}

/**
 * Ask every instance at once and keep what the ones that answered said: an instance that is down or
 * signed out never keeps the others' notifications from showing.
 */
export async function fromEvery<T>(accounts: SharedAccount[], ask: (account: SharedAccount) => Promise<T>): Promise<{ account: SharedAccount; value: T }[]> {
  const results = await Promise.allSettled(accounts.map(async (account) => ({ account, value: await ask(account) })));
  return results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
}
