/**
 * The session as the screens see it.
 *
 * Two providers answer `useSession()` (ADR 0002):
 *
 * - {@link SignInFlow}, around the screens before sign-in: finding an instance from its domain (the
 *   hub's manifest, `@ruchoir/native-client`), then signing in with its Propolis in the
 *   authentication browser. The password, the second factor, the passkeys, the sign-up and the
 *   forgotten password are Propolis's pages there; the app never sees them.
 * - each signed-in instance's scope (`accounts/InstanceScope`), which answers for its person.
 */
import { discoverInstance, NativeError, type Instance } from "@ruchoir/native-client";
import { createContext, useCallback, useContext, useMemo, useReducer, useRef, type ReactNode } from "react";

import { native, expoPlatform } from "../products/auth.ts";
import { sessionUser, type SessionUser } from "../products/index.ts";
import { sessionReducer, type SessionState } from "./machine";
import { domainOf, normalizeServer } from "./server";

export type FailureCode = "empty" | "insecure" | "invalid" | "unreachable" | "notRuchoir" | "alreadyAdded" | "unknown";

export class AuthFailure extends Error {
  constructor(readonly code: FailureCode) {
    super(code);
  }
}

export type SessionApi = {
  state: SessionState;
  /** Find the instance a domain names (its hub's manifest); refused when it is not one. */
  chooseServer: (input: string) => Promise<void>;
  changeServer: () => void;
  /** Sign in with the instance's Propolis in the authentication browser; false when it was closed. */
  signIn: () => Promise<boolean>;
  /** The invitation the flow came with, handed once to whoever accepts it after sign-in. */
  takePendingInvitation: () => string | null;
  /** Sign out; `"locked"` when the app lock does it (a forgotten PIN), which the sign-in then says. */
  signOut: (reason?: "locked") => Promise<void>;
  /** The account changed from this app: shown at once on every screen. */
  updateUser: (patch: Partial<SessionUser>) => void;
  /** Leave the flow without signing in, when the app has another instance to go back to. */
  cancel?: () => void;
};

export const SessionContext = createContext<SessionApi | null>(null);

export type FlowStart = { server: string | null; reason?: "expired" | "locked" };

type FlowProps = {
  start: FlowStart;
  invitation?: string;
  isSignedIn: (domain: string) => boolean;
  onSignedIn: (done: { instance: Instance; user: SessionUser; invitation: string | null }) => Promise<void>;
  onCancel?: () => void;
  children: ReactNode;
};

/**
 * Signing in to one instance. `start.server` is the domain of an instance being renewed (or the one
 * an invitation names); otherwise the person types one.
 */
export function SignInFlow({ start, isSignedIn, onSignedIn, onCancel, invitation: invited, children }: FlowProps) {
  const [state, dispatch] = useReducer(
    sessionReducer,
    start,
    (from): SessionState => (from.server ? { kind: "signedOut", server: from.server, reason: from.reason } : { kind: "needsServer" }),
  );
  const instance = useRef<Instance | null>(null);
  const invitation = useRef<string | null>(invited ?? null);

  const discover = useCallback(async (domain: string): Promise<Instance> => {
    try {
      return await discoverInstance(expoPlatform.fetch, domain);
    } catch (err) {
      throw new AuthFailure(err instanceof NativeError && err.code === "network" ? "unreachable" : "notRuchoir");
    }
  }, []);

  const chooseServer = useCallback(
    async (input: string) => {
      const check = normalizeServer(input);
      if (!check.ok) throw new AuthFailure(check.reason);
      const domain = domainOf(check.origin);
      if (isSignedIn(domain)) throw new AuthFailure("alreadyAdded");
      instance.current = await discover(domain);
      dispatch({ type: "serverChosen", server: instance.current.domain });
    },
    [discover, isSignedIn],
  );

  const changeServer = useCallback(() => dispatch({ type: "changeServer" }), []);

  const signIn = useCallback(async () => {
    const server = "server" in state ? state.server : null;
    if (!server) throw new AuthFailure("empty");
    const found = instance.current?.domain === server ? instance.current : await discover(server);
    instance.current = found;
    let account;
    try {
      account = await native.signIn(found);
    } catch (err) {
      // The person closed the browser, or declined: nothing to say.
      if (!(err instanceof NativeError) || err.code === "denied") return false;
      throw new AuthFailure(err.code === "network" ? "unreachable" : "unknown");
    }
    const handed = invitation.current;
    invitation.current = null;
    await onSignedIn({ instance: found, user: sessionUser(account), invitation: handed });
    return true;
  }, [state, discover, onSignedIn]);

  const takePendingInvitation = useCallback(() => {
    const token = invitation.current;
    invitation.current = null;
    return token;
  }, []);

  const signOut = useCallback(async () => {
    dispatch({ type: "signedOut" });
  }, []);
  const updateUser = useCallback((patch: Partial<SessionUser>) => dispatch({ type: "userUpdated", patch }), []);

  const api = useMemo<SessionApi>(
    () => ({ state, chooseServer, changeServer, signIn, takePendingInvitation, signOut, updateUser, cancel: onCancel }),
    [state, chooseServer, changeServer, signIn, takePendingInvitation, signOut, updateUser, onCancel],
  );
  return <SessionContext.Provider value={api}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionApi {
  const api = useContext(SessionContext);
  if (!api) throw new Error("useSession outside a session provider");
  return api;
}
