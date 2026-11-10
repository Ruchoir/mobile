/**
 * Everything that belongs to one signed-in instance and lives as long as its session (ADR 0007): its
 * client (`useApi`), its session as the screens know it (`useSession`), its realtime socket, the
 * messages and files on their way out, and its spaces.
 *
 * A scope is mounted for every signed-in instance, the one on screen or not: that keeps the person
 * online there, its counts live for the space sheet and the bell (its summary), and a message or a
 * file being sent on one instance going out while another is read. Only the active scope draws the
 * interface (`children`), so switching instance mounts a fresh navigation in the new one and nothing
 * of the last one's screens survives there.
 */
import type { SessionUser } from "../products/index.ts";
import { useCallback, useEffect, useMemo, type ReactNode } from "react";

import { ApiProvider, useApi } from "../api/useApi";
import { OutboxProvider } from "../compose/useOutbox";
import { useLoad } from "../data/useLoad";
import { useReloadOn } from "../data/useReloadOn";
import { AccountPrefsSync } from "../prefs/AccountPrefsSync";
import { RealtimeProvider } from "../realtime/RealtimeProvider";
import { SessionContext, type SessionApi } from "../session/SessionProvider";
import { SpaceProvider, useSpace } from "../space/SpaceProvider";
import { UploadsProvider } from "../uploads/UploadsProvider";
import { useAccounts, type Account } from "./AccountsProvider";

export function InstanceScope({ account, user, active, children }: { account: Account; user: SessionUser; active: boolean; children: ReactNode }) {
  return (
    <ApiProvider client={account.client}>
      <ScopeSession account={account} user={user}>
        <RealtimeProvider>
          <OutboxProvider>
            <SpaceProvider instanceId={account.id}>
              <UploadsProvider>
                <SummaryPublisher id={account.id} />
                <AccountPrefsSync userId={user.id} />
                {active ? children : null}
              </UploadsProvider>
            </SpaceProvider>
          </OutboxProvider>
        </RealtimeProvider>
      </ScopeSession>
    </ApiProvider>
  );
}

function ScopeSession({ account, user, children }: { account: Account; user: SessionUser; children: ReactNode }) {
  const accounts = useAccounts();
  const { id, origin } = account;
  const { signOutOf, signOutEverywhere, updateUser: update, takeInvitation } = accounts;

  const signOut = useCallback(async (reason?: "locked") => (reason ? signOutEverywhere(reason) : signOutOf(id)), [id, signOutOf, signOutEverywhere]);
  const updateUser = useCallback((patch: Partial<SessionUser>) => update(id, patch), [id, update]);
  const takePendingInvitation = useCallback(() => takeInvitation(id), [id, takeInvitation]);

  const value = useMemo<SessionApi>(
    () => ({
      state: { kind: "signedIn", server: origin, user },
      // Inside a scope the person is signed in: there is no instance to choose.
      chooseServer: async () => {},
      changeServer: () => {},
      signIn: async () => true,
      takePendingInvitation,
      signOut,
      updateUser,
    }),
    [origin, user, takePendingInvitation, signOut, updateUser],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

/** The instance's spaces and unread notifications, for what is drawn outside its screens. */
function SummaryPublisher({ id }: { id: string }) {
  const { getNotifications } = useApi();
  const { publishSummary } = useAccounts();
  const { spaces } = useSpace();
  const inbox = useLoad("summary:inbox", (signal) => getNotifications({ unread: true, limit: 1, guestNotices: true }, signal));
  useReloadOn((e) => e.type === "notification", inbox.reload, 600);
  const unreadNotifications = inbox.data?.unreadCount;
  const list = spaces.data;
  useEffect(() => {
    if (list) publishSummary(id, { spaces: list, unreadNotifications: unreadNotifications ?? 0 });
  }, [id, list, unreadNotifications, publishSummary]);
  return null;
}
