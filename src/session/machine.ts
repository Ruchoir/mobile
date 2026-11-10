/**
 * Where the app stands with the instance being signed in to, as a plain reducer so it can be tested
 * without a phone.
 *
 * - `booting`: reading the Keychain.
 * - `needsServer`: no instance chosen yet (or the person asked to change it).
 * - `signedOut`: an instance found, no grant; `reason: "expired"` when Propolis ended one,
 *   `"locked"` when the app lock signed out (a forgotten PIN, too many wrong ones).
 * - `signedIn`: a grant, and the person it belongs to.
 *
 * The password, the second factor and the passkeys are Propolis's pages, in the authentication
 * browser: the app never sees them.
 */
import type { SessionUser } from "../products/index.ts";

export type SessionState =
  | { kind: "booting" }
  | { kind: "needsServer" }
  | { kind: "signedOut"; server: string; reason?: "expired" | "locked" }
  | { kind: "signedIn"; server: string; user: SessionUser };

export type SessionEvent =
  | { type: "restored"; server: string | null; user: SessionUser | null }
  | { type: "serverChosen"; server: string }
  | { type: "changeServer" }
  | { type: "authenticated"; user: SessionUser }
  /** The account changed from this app (status, zone): the screens show it at once. */
  | { type: "userUpdated"; patch: Partial<SessionUser> }
  | { type: "unauthorized" }
  | { type: "signedOut"; reason?: "locked" };

export function sessionReducer(state: SessionState, event: SessionEvent): SessionState {
  const server = "server" in state ? state.server : null;
  switch (event.type) {
    case "restored":
      if (!event.server) return { kind: "needsServer" };
      return event.user
        ? { kind: "signedIn", server: event.server, user: event.user }
        : { kind: "signedOut", server: event.server };
    case "serverChosen":
      return { kind: "signedOut", server: event.server };
    case "changeServer":
      return { kind: "needsServer" };
    case "authenticated":
      return server ? { kind: "signedIn", server, user: event.user } : state;
    case "userUpdated":
      return state.kind === "signedIn" ? { ...state, user: { ...state.user, ...event.patch } } : state;
    case "unauthorized":
      // Only a live session can expire; anything else is already where a 401 would send it.
      return state.kind === "signedIn" ? { kind: "signedOut", server: state.server, reason: "expired" } : state;
    case "signedOut":
      if (!server) return { kind: "needsServer" };
      return event.reason ? { kind: "signedOut", server, reason: event.reason } : { kind: "signedOut", server };
  }
}
