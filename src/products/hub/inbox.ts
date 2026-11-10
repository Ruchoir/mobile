/**
 * The person's inbox, from the hub (`GET /api/v1/me/inbox`, `POST /api/v1/me/inbox/{id}/read`,
 * `POST /api/v1/me/inbox/read`).
 *
 * Every product writes its notifications to the hub, which keeps one inbox per person. An entry
 * names its product, its kind, its organisation, its link and the `variables` its sentence is drawn
 * from; the app's notification rows still read the monolith's shape (`ApiNotification`), so each
 * entry is mapped onto it here, from the variables a product sets when it has them.
 */
import type { Transport } from "../shared/http.ts";
import type { ApiNotification, NotificationFeed } from "../shared/model.ts";

/** An inbox entry, as `contract/openapi-v1.json` of Ruchoir/hub describes it. */
export type InboxEntryDto = {
  id: string;
  product: string;
  kind: string;
  category: string;
  object: string;
  organisation: string | null;
  actor: string | null;
  link: string;
  variables: Record<string, unknown>;
  created_at: string;
  read_at: string | null;
};

type InboxPageDto = { entries: InboxEntryDto[]; next_before: string | null; unread_count: number };

const KINDS: ApiNotification["kind"][] = [
  "mention", "broadcast", "reply", "dm", "message", "reaction", "edited", "calendar_reminder",
  "calendar_invitation", "calendar_update", "calendar_cancel", "calendar_declined", "calendar_shared",
  "guest_expiry_soon", "guest_access_ending",
];

const text = (value: unknown): string => (typeof value === "string" ? value : "");

/** An inbox entry as the app's notification rows read it. */
export function toNotification(entry: InboxEntryDto): ApiNotification {
  const v = entry.variables ?? {};
  // A calendar's kinds are named without the product (`reminder`), the chat's as the monolith did.
  const named = entry.product === "calendar" && !entry.kind.startsWith("calendar_") ? `calendar_${entry.kind}` : entry.kind;
  const kind = (KINDS as string[]).includes(named) ? (named as ApiNotification["kind"]) : "message";
  return {
    id: entry.id,
    kind,
    conversationId: text(v.conversation_id),
    spaceId: entry.organisation ?? "",
    channelName: text(v.channel_name) || undefined,
    spaceName: text(v.organisation_name),
    messageId: text(v.message_id),
    actor: text(v.actor_name) || entry.actor || "",
    preview: text(v.body) || text(v.title),
    createdAt: entry.created_at,
    read: entry.read_at !== null,
    calendarName: text(v.calendar_name) || undefined,
    emoji: text(v.emoji) || undefined,
  };
}

export function createInboxApi(transport: Transport) {
  const { apiGet, apiPost } = transport;

  /** `GET /me/inbox`: newest first, with the unread count. Guest notices come from Propolis now. */
  async function getNotifications(
    opts: { unread?: boolean; before?: string; limit?: number; guestNotices?: boolean } = {},
    signal?: AbortSignal,
  ): Promise<NotificationFeed> {
    const params = new URLSearchParams();
    if (opts.unread) params.set("unread", "true");
    if (opts.before) params.set("before", opts.before);
    if (opts.limit) params.set("limit", String(opts.limit));
    const query = params.toString();
    const page = await apiGet<InboxPageDto>(`/me/inbox${query ? `?${query}` : ""}`, signal);
    return {
      notifications: page.entries.map(toNotification),
      nextBefore: page.next_before ?? undefined,
      unreadCount: page.unread_count,
    };
  }

  /** `POST /me/inbox/{id}/read`. The options of the monolith's call are accepted and unused. */
  async function markNotificationRead(id: string, _opts: { guestNotices?: boolean } = {}): Promise<void> {
    await apiPost<void>(`/me/inbox/${encodeURIComponent(id)}/read`);
  }

  /** `POST /me/inbox/read`: every entry. */
  async function markAllNotificationsRead(_opts: { guestNotices?: boolean } = {}): Promise<void> {
    await apiPost<void>("/me/inbox/read");
  }

  return { getNotifications, markNotificationRead, markAllNotificationsRead };
}

export type InboxApi = ReturnType<typeof createInboxApi>;
