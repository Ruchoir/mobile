/**
 * The hub's API (`contract/openapi-v1.json` of Ruchoir/hub): presence, notification preferences and
 * the phone's push registration. The inbox is in `inbox.ts`.
 *
 * Each call is the route of the product, made with its own access token (`../http`).
 */
import type { Transport } from "../shared/http.ts";
import { type AccountPrefsDoc } from "../shared/accountPrefs.ts";
import { toEventCard } from "../shared/calendarModel.ts";
import { type ChannelType, type InlineImage, type MessageAttachment, type MessageKind, type Presence, type PresenceChoice, type SpaceFile } from "../shared/types.ts";
import { NOTIFICATION_FIELDS, REALTIME_EVENTS, WS_ATTEMPTS_BEFORE_SSE, attachmentIcon, canFallBackToSse, iconForSystemEvent, isSystemEvent, toApiNotification, toImportSource, toPresence, toReaction, toSpaceFileKind } from "../shared/model.ts";
import type { ApiMessage, AttachmentDto, ChannelMembership, FileDto, MemberDto, MessageDto, NotificationDto, NotificationPreferences, PresenceDto, PushConfig, RealtimeChannel, RealtimeConnection, RealtimeEnvelope, RealtimeHandlers } from "../shared/model.ts";

export function createHubApi(transport: Transport) {
  const { apiRequest, apiGet, apiPost, apiPut, apiBase, apiOrigin, clientOptions } = transport;

  // --- Phone notifications (ADR 0006) ---

  /**
   * `PUT /push/devices`: remember this phone for the signed-in account, or refresh it (the app does
   * at every start while notifications are allowed). A 409 means the instance keeps phones out.
   */
  async function registerPushDevice(platform: "ios" | "android", token: string): Promise<void> {
    await apiPut<void>("/me/push/devices", { platform, token });
  }

  /** `DELETE /push/devices`: forget this phone (signing out, or notifications turned off here). */
  async function forgetPushDevice(token: string): Promise<void> {
    await apiRequest<void>("DELETE", "/me/push/devices", { json: { token } });
  }

  /** `GET /organisations/{id}/presence`: the current presence of the space's members, keyed by user id. */
  async function getSpacePresence(spaceId: string, signal?: AbortSignal): Promise<Record<string, Presence>> {
    const rows = await apiGet<PresenceDto[]>(`/organisations/${spaceId}/presence`, signal);
    const out: Record<string, Presence> = {};
    for (const row of rows) out[row.user_id] = toPresence(row.presence);
    return out;
  }

  /**
   * `PUT /me/presence`: set the caller's availability, and return the presence that results.
   *
   * `auto` sends `null`, which is the API's way of saying "derive it from the connection". It is what
   * the menu's ordinary "En ligne" entry sends and the state a user is normally in, without any of
   * that being surfaced to them. Nothing ever sent it before: every entry wrote a fixed override, so
   * picking "online" once left a user green for good, with no way back through the interface. The response is the server's own answer and is what the caller should display,
   * rather than assuming the choice took effect as asked.
   */
  async function setMyPresence(choice: PresenceChoice): Promise<Presence> {
    const manual =
      choice === "auto" ? null : choice === "busy" ? "dnd" : choice === "away" ? "away" : "invisible";
    const dto = await apiPut<PresenceDto>("/me/presence", { manual_presence: manual });
    return toPresence(dto.presence);
  }

  // --- Mapping helpers ---

  function toMessage(dto: MessageDto): ApiMessage {
    const { attachment, attachments, image, images } = splitAttachments(dto.attachments);
    return {
      id: dto.id,
      kind: (dto.kind === "system" ? "system" : "message") as MessageKind,
      author: dto.author_name ?? "",
      authorId: dto.author_id ?? undefined,
      createdAt: dto.created_at,
      body: dto.body,
      // A known event is rendered from its sentence, with the body as its one detail when it has one.
      // A system message with a body and no known event is older free text, shown as written.
      system:
        dto.kind === "system" && isSystemEvent(dto.system_event)
          ? { event: dto.system_event, actor: dto.author_name ?? "", detail: dto.body || undefined }
          : undefined,
      systemIcon: dto.kind === "system" ? iconForSystemEvent(dto.system_event) : undefined,
      eventCard: dto.event ? toEventCard(dto.event) : undefined,
      attachment,
      attachments,
      image,
      images,
      reactions: dto.reactions.length > 0 ? dto.reactions.map(toReaction) : undefined,
      parentId: dto.parent_message_id,
      alsoInChannel: dto.also_in_channel || undefined,
      threadRoot: dto.thread_root
        ? { id: dto.thread_root.id, authorName: dto.thread_root.author_name, excerpt: dto.thread_root.excerpt }
        : undefined,
      replies: dto.reply_count > 0 ? dto.reply_count : undefined,
      replyAuthors: dto.reply_authors?.length ? dto.reply_authors : undefined,
      lastReplyAt: dto.last_reply_at,
      imported: dto.imported || undefined,
      pinned: dto.pinned || undefined,
      pinnedBy: dto.pinned_by,
      edited: dto.edited || undefined,
      editedAt: dto.edited_at,
      deleted: dto.deleted || undefined,
      saved: dto.saved || undefined,
      link: dto.link
        ? {
            url: dto.link.url,
            domain: dto.link.domain,
            title: dto.link.title,
            description: dto.link.description,
            // Only a plain hex colour reaches a style attribute.
            color: dto.link.color && /^#[0-9a-f]{6}$/i.test(dto.link.color) ? dto.link.color : undefined,
            imageUrl: dto.link.image_url,
            imageWidth: dto.link.image_width,
            imageHeight: dto.link.image_height,
          }
        : undefined,
    };
  }

  /**
   * Keep attachment order while retaining the first-item aliases used by compact legacy views.
   */
  function splitAttachments(attachments: AttachmentDto[]): {
    attachment?: MessageAttachment;
    attachments?: MessageAttachment[];
    image?: InlineImage;
    images?: InlineImage[];
  } {
    const attachmentsOut: MessageAttachment[] = [];
    const imagesOut: InlineImage[] = [];
    for (const a of attachments) {
      // A file removed from the space keeps its place in the message, without a link: every URL to
      // its bytes answers 404, and an image whose source 404s is a broken frame rather than an
      // absence. What the message carried is still worth saying; what it carried is simply gone.
      if (a.deleted) {
        attachmentsOut.push({
          fileId: a.file_id,
          name: a.name,
          sizeBytes: a.size_bytes,
          kind: attachmentIcon(a.kind),
          deleted: true,
        });
        continue;
      }
      if (a.kind === "image" && a.image_width && a.image_height) {
        imagesOut.push({
          fileId: a.file_id,
          alt: a.alt_text ?? a.name,
          name: a.name,
          width: a.image_width,
          height: a.image_height,
          // Served by the API, never by the object store: the browser never talks to it directly.
          // `preview` is the original bytes, so opening it in a tab shows full quality.
          src: `${apiBase()}/files/${a.file_id}/preview`,
          downloadUrl: `${apiBase()}/files/${a.file_id}/download`,
        });
      } else {
        attachmentsOut.push({
          fileId: a.file_id,
          name: a.name,
          sizeBytes: a.size_bytes,
          kind: attachmentIcon(a.kind),
          url: `${apiBase()}/files/${a.file_id}/download`,
          previewUrl: `${apiBase()}/files/${a.file_id}/preview`,
        });
      }
    }
    return {
      attachment: attachmentsOut[0],
      attachments: attachmentsOut.length ? attachmentsOut : undefined,
      image: imagesOut[0],
      images: imagesOut.length ? imagesOut : undefined,
    };
  }

  async function getNotificationPreferences(signal?: AbortSignal): Promise<NotificationPreferences> {
    const dto = await apiGet<Record<string, unknown>>("/me/notification-preferences", signal);
    return Object.fromEntries(
      NOTIFICATION_FIELDS.map(([field, wire]) => [field, dto[wire]]),
    ) as NotificationPreferences;
  }

  /** `PUT /me/notification-preferences`: replace them whole. */
  async function saveNotificationPreferences(prefs: NotificationPreferences): Promise<void> {
    await apiPut<void>(
      "/me/notification-preferences",
      Object.fromEntries(NOTIFICATION_FIELDS.map(([field, wire]) => [wire, prefs[field]])),
    );
  }

  /** `GET /push/config`. */
  async function getPushConfig(signal?: AbortSignal): Promise<PushConfig> {
    const dto = await apiGet<{ available: boolean; public_key?: string }>("/push/config", signal);
    return { available: dto.available, publicKey: dto.public_key };
  }

  /**
   * `POST /push/devices/test`: wake each of the caller's phones with the test notification, through
   * the relay, as a real one would. A `409` when there is no phone, no relay, or a test was just sent.
   */
  async function sendPhoneTestPush(): Promise<{ devices: number }> {
    return apiPost<{ devices: number }>("/me/push/devices/test");
  }

  // --- Search ---


  // --- Files ---

  function toSpaceFile(dto: FileDto): SpaceFile {
    return {
      id: dto.id,
      name: dto.name,
      kind: toSpaceFileKind(dto.kind, dto.is_folder),
      sizeBytes: dto.is_folder ? 0 : dto.size_bytes,
      by: dto.owner_name ?? "",
      updatedAt: dto.updated_at,
      // The connector a migrated file came from; native files (and unknown connectors) read as Ruchoir.
      source: toImportSource(dto.imported_source) ?? "Ruchoir",
      version: dto.version_no != null ? `v${dto.version_no}` : "",
      imported: dto.imported,
      // Generated and stored server-side at upload; served by the API, never by the object store.
      thumbnailUrl: dto.has_thumbnail ? `${apiBase()}/files/${dto.id}/thumbnail` : undefined,
      parentFolderId: dto.parent_folder_id,
      editors: dto.editors ?? [],
      ownerId: dto.owner_id,
      modifiedBy: dto.modified_by_name,
      childCount: dto.child_count,
      createdAt: dto.created_at,
      mimeType: dto.mime_type,
      versionNo: dto.version_no,
      starred: dto.starred === true,
      myPermissions: dto.my_permissions,
    };
  }

  // --- Realtime (WebSocket) ---

  /** The realtime socket's address: `wss://` on the instance's origin (`ws://` only for plain http). */
  function realtimeSocketUrl(): string {
    return `${apiOrigin().replace(/^http/, "ws")}/api/v1/live/ws`;
  }

  /**
   * Open the realtime channel and dispatch decoded events to `handlers`.
   *
   * A WebSocket first: it carries both directions, so typing and the keep-alive travel on the same
   * connection. It authenticates on the upgrade, from the same-origin session cookie on the web and
   * from the bearer header a native app's `openSocket` adds, and reconnects with a capped backoff
   * after an unexpected close.
   *
   * **Server-sent events when that never opens.** Some corporate proxies pass ordinary HTTP and drop
   * the upgrade, and Ruchoir is aimed squarely at organisations that sit behind such things: the
   * fallback exists in the API and was, until now, offered to nobody. It is one-way, so typing goes
   * over `POST /realtime/typing` instead, and presence is kept by a server-side timer rather than by
   * pings. The switch is made only after the socket has failed without ever opening: a connection
   * that opens and later drops is a network blip, and downgrading on one of those would leave a
   * client on the weaker transport for the rest of its session.
   *
   * All mutations still go through REST either way; this only receives.
   */
  function connectRealtime(handlers: RealtimeHandlers): RealtimeConnection {
    let socket: WebSocket | null = null;
    let events: EventSource | null = null;
    let closed = false;
    let reconnectDelay = 1000;
    /** Whether a connection has been up before, which makes the next one a reconnection. */
    let everOpened = false;
    const opened = () => {
      if (everOpened) handlers.onReconnect?.();
      everOpened = true;
    };
    let failedAttempts = 0;
    let pingTimer: ReturnType<typeof setInterval> | undefined;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

    const dispatch = (env: RealtimeEnvelope) => {
      const conv = env.conversation_id ?? "";
      const payload = env.payload as Record<string, unknown>;
      switch (env.type) {
        case "message.created":
          handlers.onMessageCreated?.(conv, toMessage(payload as unknown as MessageDto));
          break;
        case "message.updated":
          handlers.onMessageUpdated?.(conv, toMessage(payload as unknown as MessageDto));
          break;
        case "message.deleted":
          handlers.onMessageDeleted?.(conv, toMessage(payload as unknown as MessageDto));
          break;
        case "reaction.added":
        case "reaction.removed":
          handlers.onReaction?.(conv, {
            messageId: String(payload.message_id),
            emoji: String(payload.emoji),
            userId: String(payload.user_id),
            added: env.type === "reaction.added",
          });
          break;
        case "message.pinned":
        case "message.unpinned":
          handlers.onPinned?.(conv, String(payload.message_id), env.type === "message.pinned");
          break;
        case "channel.created":
        case "channel.updated": {
          const channel: RealtimeChannel = {
            id: String(payload.id),
            spaceId: String(payload.space_id),
            name: String(payload.name),
            type: (["public", "private", "archived"].includes(String(payload.type))
              ? String(payload.type)
              : "public") as ChannelType,
            topic: payload.topic === undefined ? undefined : String(payload.topic),
          };
          if (env.type === "channel.created") handlers.onChannelCreated?.(channel);
          else handlers.onChannelUpdated?.(channel);
          break;
        }
        case "member.joined": {
          const member = payload.member as MemberDto;
          handlers.onMemberJoined?.({
            spaceId: String(payload.space_id),
            userId: member.user_id,
            name: member.display_name,
            role: member.role,
            title: member.title,
            bot: member.is_bot,
            avatarUrl: member.avatar_url,
          });
          break;
        }
        case "member.left":
          handlers.onMemberLeft?.(String(payload.space_id), String(payload.user_id));
          break;
        case "channel.deleted":
          handlers.onChannelDeleted?.(String(payload.space_id), String(payload.channel_id));
          break;
        case "member.role_changed":
          handlers.onMemberRoleChanged?.(
            String(payload.space_id),
            String(payload.user_id),
            String(payload.role),
          );
          break;
        case "space.removed": {
          const reason = String(payload.reason);
          handlers.onSpaceRemoved?.(
            String(payload.space_id),
            reason === "deleted" || reason === "removed" ? reason : "left",
          );
          break;
        }
        case "channels.reordered":
          handlers.onChannelsReordered?.(String(payload.space_id));
          break;
        case "permissions.changed":
          handlers.onPermissionsChanged?.(String(payload.space_id));
          break;
        case "preferences.updated": {
          const changes = payload.changes;
          if (changes && typeof changes === "object" && !Array.isArray(changes)) {
            handlers.onPreferencesUpdated?.(changes as AccountPrefsDoc);
          }
          break;
        }
        case "dm.hidden":
          handlers.onDmHidden?.(String(payload.dm_id), payload.hidden === true);
          break;
        case "channel.membership":
          handlers.onChannelMembership?.({
            spaceId: String(payload.space_id),
            channelId: String(payload.channel_id),
            userId: String(payload.user_id),
            change: payload.change as ChannelMembership["change"],
            role: typeof payload.role === "string" ? payload.role : undefined,
          });
          break;
        case "space.updated": {
          handlers.onSpaceUpdated?.({
            id: String(payload.id),
            name: String(payload.name),
            slug: String(payload.slug),
            iconUrl: (payload.icon_url as string | null) ?? undefined,
            defaultChannelId: (payload.default_channel_id as string | null) ?? undefined,
          });
          break;
        }
        case "member.updated": {
          // A replacement, not a patch: every field is serialised, so `null` means "cleared" and is
          // carried through as `undefined` rather than being read as "unchanged".
          handlers.onMemberUpdated?.({
            userId: String(payload.user_id),
            name: String(payload.display_name),
            title: (payload.title as string | null) ?? undefined,
            bot: Boolean(payload.is_bot),
            avatarUrl: (payload.avatar_url as string | null) ?? undefined,
          });
          break;
        }
        case "presence":
          handlers.onPresence?.(String(payload.user_id), toPresence(String(payload.presence)));
          break;
        case "notification.created":
          handlers.onNotification?.(toApiNotification(payload as unknown as NotificationDto));
          break;
        case "notification.read":
          handlers.onNotificationsRead?.({
            ids: Array.isArray(payload.ids) ? (payload.ids as unknown[]).map(String) : [],
            all: Boolean(payload.all),
            unreadCount: typeof payload.unread_count === "number" ? payload.unread_count : undefined,
          });
          break;
        case "typing":
          handlers.onTyping?.(conv, String(payload.user_id));
          break;
        case "read.updated":
          handlers.onReadCursor?.(conv, String(payload.user_id), String(payload.last_read_message_id));
          break;
        case "files.deleted":
          handlers.onFilesDeleted?.(String(payload.space_id), (payload.file_ids as string[]) ?? []);
          break;
        case "calendar.changed":
          handlers.onCalendarChanged?.(String(payload.calendar_id));
          break;
        case "files.updated":
          handlers.onFilesUpdated?.(
            String(payload.space_id),
            toSpaceFile(payload.file as unknown as FileDto),
            payload.conversation_id ? String(payload.conversation_id) : undefined,
          );
          break;
        case "files.editing":
          handlers.onFilesEditing?.(
            String(payload.space_id),
            String(payload.file_id),
            ((payload.editors as { id: string; name: string }[]) ?? []).map((e) => ({ id: e.id, name: e.name })),
          );
          break;
        default:
          // Unhandled event types (saved) are ignored for now.
          break;
      }
    };

    const connect = () => {
      if (closed) return;
      // A way to reach the fallback on purpose. Without it the only way to see the SSE path is to be
      // behind a proxy that blocks the upgrade, which is exactly the situation nobody developing the
      // product is in, and is how a fallback rots unnoticed.
      // React Native has a `window` but no `location` on it.
      const search = typeof window !== "undefined" ? window.location?.search : undefined;
      if (search && new URLSearchParams(search).get("transport") === "sse" && canFallBackToSse()) {
        startEvents();
        return;
      }
      let ws: WebSocket;
      try {
        ws = clientOptions().openSocket(realtimeSocketUrl());
      } catch {
        scheduleReconnect();
        return;
      }
      socket = ws;
      ws.onopen = () => {
        reconnectDelay = 1000;
        failedAttempts = 0;
        opened();
        pingTimer = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "ping" }));
        }, 25000);
      };
      ws.onmessage = (event) => {
        try {
          dispatch(JSON.parse(event.data as string) as RealtimeEnvelope);
        } catch {
          // Ignore an unparseable frame rather than tearing the connection down.
        }
      };
      ws.onclose = (event) => {
        clearInterval(pingTimer);
        if (closed) return;
        // `wasClean` is false for a handshake a proxy refused, and true for a socket that lived and
        // then ended. Only the first kind counts towards giving up on WebSocket.
        if (!event.wasClean) failedAttempts += 1;
        if (failedAttempts >= WS_ATTEMPTS_BEFORE_SSE && canFallBackToSse()) {
          startEvents();
          return;
        }
        scheduleReconnect();
      };
      ws.onerror = () => {
        // The close handler drives reconnection; nothing extra to do here.
      };
    };

    /**
     * The one-way fallback. `EventSource` reconnects on its own, so there is no backoff to write
     * here; what it cannot do is tell us the response was a 401, which is why a closed connection
     * that never delivers is left to the session check on the next navigation.
     */
    const startEvents = () => {
      if (closed || events) return;
      socket = null;
      try {
        events = new EventSource(`${apiBase()}/realtime/sse`, { withCredentials: true });
      } catch {
        scheduleReconnect();
        return;
      }
      // `EventSource` reopens on its own after a drop, and says so with `open` each time.
      events.addEventListener("open", opened);
      for (const name of REALTIME_EVENTS) {
        events.addEventListener(name, (event) => {
          try {
            dispatch(JSON.parse((event as MessageEvent<string>).data) as RealtimeEnvelope);
          } catch {
            // Same as on the socket: an unparseable frame is dropped, not fatal.
          }
        });
      }
    };

    const scheduleReconnect = () => {
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connect, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, 15000);
    };

    connect();

    return {
      close: () => {
        closed = true;
        clearInterval(pingTimer);
        clearTimeout(reconnectTimer);
        socket?.close();
        events?.close();
        events = null;
      },
      sendTyping: (conversationId: string) => {
        if (socket?.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "typing", conversation_id: conversationId }));
          return;
        }
        // Nothing travels up an event stream, so on the fallback this is a request. Best-effort, as
        // it is on the socket: a typing signal nobody receives is not worth reporting.
        if (events) {
          void apiPost<void>("/realtime/typing", { conversation_id: conversationId }).catch(() => {});
        }
      },
    };
  }

  return {
    getSpacePresence, setMyPresence, getNotificationPreferences, saveNotificationPreferences, getPushConfig, registerPushDevice, forgetPushDevice, sendPhoneTestPush, connectRealtime, realtimeSocketUrl,
  };
}

export type HubApi = ReturnType<typeof createHubApi>;
