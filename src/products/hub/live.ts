/**
 * The frames of the hub's live socket, dispatched to the app's handlers.
 *
 * Each frame is a product's `ClientFrame` (`ruchoir-events` of Ruchoir/core): `{ v, type, scope?,
 * payload }`, its `type` named after the product that published it. The hub forwards it unread, so
 * the payloads below are the products' own (Ruchoir/chat `src/chat/live.rs`, Ruchoir/drive
 * `src/files/live.rs` and `src/office/presence.rs`, Ruchoir/calendar `src/calendar/live.rs`, and the
 * hub's `src/inbox.rs` and `src/live/presence.rs`). A frame the app does not know is ignored.
 */
import { toMessage } from "../chat/model.ts";
import { toPresence } from "../shared/model.ts";
import type { ChannelMembership, MessageDto, RealtimeEnvelope, RealtimeHandlers } from "../shared/model.ts";
import type { ChannelType } from "../shared/types.ts";

/** The frame types the app reads, as the products publish them. */
export const FRAME = {
  messageCreated: "chat.message.created",
  messageUpdated: "chat.message.updated",
  messageDeleted: "chat.message.deleted",
  reactionAdded: "chat.reaction.added",
  reactionRemoved: "chat.reaction.removed",
  messagePinned: "chat.message.pinned",
  messageUnpinned: "chat.message.unpinned",
  channelCreated: "chat.channel.created",
  channelUpdated: "chat.channel.updated",
  channelDeleted: "chat.channel.deleted",
  channelsReordered: "chat.channels.reordered",
  channelMembership: "chat.channel.membership",
  dmHidden: "chat.dm.hidden",
  readUpdated: "chat.read.updated",
  typing: "chat.typing",
  filesUpdated: "drive.files.updated",
  filesDeleted: "drive.files.deleted",
  filesEditing: "drive.files.editing",
  calendarChanged: "calendar.changed",
  inboxNew: "hub.inbox.new",
  inboxRead: "hub.inbox.read",
  presenceChanged: "hub.presence.changed",
} as const;

const str = (value: unknown): string => (value === undefined || value === null ? "" : String(value));

/** Dispatch one frame to `handlers`. */
export function dispatchFrame(env: RealtimeEnvelope, handlers: RealtimeHandlers): void {
  const payload = (env.payload ?? {}) as Record<string, unknown>;
  switch (env.type) {
    case FRAME.messageCreated:
    case FRAME.messageUpdated:
    case FRAME.messageDeleted: {
      const dto = payload as unknown as MessageDto;
      const conversation = env.scope ?? dto.conversation_id;
      const message = toMessage(dto);
      if (env.type === FRAME.messageCreated) handlers.onMessageCreated?.(conversation, message);
      else if (env.type === FRAME.messageUpdated) handlers.onMessageUpdated?.(conversation, message);
      else handlers.onMessageDeleted?.(conversation, message);
      break;
    }
    case FRAME.reactionAdded:
    case FRAME.reactionRemoved:
      handlers.onReaction?.(str(payload.conversation_id ?? env.scope), {
        messageId: str(payload.message_id),
        emoji: str(payload.emoji),
        userId: str(payload.user_id),
        added: env.type === FRAME.reactionAdded,
      });
      break;
    case FRAME.messagePinned:
    case FRAME.messageUnpinned:
      // A pin belongs to a channel, which is the conversation.
      handlers.onPinned?.(str(payload.channel_id ?? env.scope), str(payload.message_id), env.type === FRAME.messagePinned);
      break;
    case FRAME.channelCreated:
    case FRAME.channelUpdated: {
      const type = str(payload.type);
      const channel = {
        id: str(payload.id),
        spaceId: str(payload.organisation_id),
        name: str(payload.name),
        type: (["public", "private", "archived"].includes(type) ? type : "public") as ChannelType,
        topic: payload.topic === undefined || payload.topic === null ? undefined : String(payload.topic),
      };
      if (env.type === FRAME.channelCreated) handlers.onChannelCreated?.(channel);
      else handlers.onChannelUpdated?.(channel);
      break;
    }
    case FRAME.channelDeleted:
      handlers.onChannelDeleted?.(str(payload.organisation_id), str(payload.channel_id));
      break;
    case FRAME.channelsReordered:
      handlers.onChannelsReordered?.(str(payload.organisation_id));
      break;
    case FRAME.channelMembership:
      handlers.onChannelMembership?.({
        spaceId: str(payload.organisation_id),
        channelId: str(payload.channel_id),
        userId: str(payload.user_id),
        change: payload.change as ChannelMembership["change"],
        role: typeof payload.role === "string" ? payload.role : undefined,
      });
      break;
    case FRAME.dmHidden:
      handlers.onDmHidden?.(str(payload.dm_id), payload.hidden === true);
      break;
    case FRAME.readUpdated:
      handlers.onReadCursor?.(str(payload.conversation_id ?? env.scope), str(payload.user_id), str(payload.last_read_message_id));
      break;
    case FRAME.typing:
      handlers.onTyping?.(str(payload.conversation_id ?? env.scope), str(payload.user_id));
      break;
    case FRAME.filesUpdated:
      handlers.onFilesUpdated?.(str(payload.organisation), payload.folder ? String(payload.folder) : undefined);
      break;
    case FRAME.filesDeleted:
      handlers.onFilesDeleted?.(str(payload.organisation), Array.isArray(payload.files) ? payload.files.map(String) : []);
      break;
    case FRAME.filesEditing:
      // The drive names the editors by account; the screens find their names among the members.
      handlers.onFilesEditing?.(
        str(payload.organisation),
        str(payload.file),
        (Array.isArray(payload.editors) ? payload.editors : []).map((id) => ({ id: String(id), name: "" })),
      );
      break;
    case FRAME.calendarChanged:
      handlers.onCalendarChanged?.(str(payload.calendar_id));
      break;
    case FRAME.inboxNew:
      handlers.onNotification?.({
        kind: str(payload.kind),
        category: str(payload.category),
        organisationId: payload.organisation ? String(payload.organisation) : undefined,
      });
      break;
    case FRAME.inboxRead:
      handlers.onNotificationsRead?.({
        ids: Array.isArray(payload.ids) ? payload.ids.map(String) : [],
        all: Boolean(payload.all),
        unreadCount: typeof payload.unread_count === "number" ? payload.unread_count : undefined,
      });
      break;
    case FRAME.presenceChanged:
      handlers.onPresence?.(str(payload.account), toPresence(str(payload.presence)));
      break;
    default:
      // Saved messages, and anything newer than this app, are not shown live.
      break;
  }
}
