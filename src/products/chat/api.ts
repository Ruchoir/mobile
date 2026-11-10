/**
 * The chat's API (`contract/openapi-v1.json` of Ruchoir/chat): channels, direct messages, messages,
 * reactions, pins, saved messages, read cursors and an organisation's members.
 *
 * Each call is the route of the product, made with its own access token (`../http`).
 */
import type { Transport } from "../shared/http.ts";
import { toEventCard } from "../shared/calendarModel.ts";
import { type Channel, type ChannelType, type ConversationNotify, type DirectMessage, type InlineImage, type MessageAttachment, type MessageKind } from "../shared/types.ts";
import { attachmentIcon, iconForSystemEvent, isSystemEvent, toChannel, toDirectMessage, toMember, toReaction } from "../shared/model.ts";
import type { ApiMessage, AttachmentDto, ChannelDto, DirectMessageDto, Member, MemberDto, MessageDto, MessagePage, MessagePageDto, ReadCursor, SavedMessage, SpaceChanges, SpaceIdentity } from "../shared/model.ts";

export function createChatApi(transport: Transport) {
  const { apiGet, apiPost, apiPut, apiPatch, apiDelete, apiBase } = transport;

  /**
   * `PUT /organisations/{id}/channel-order`: the space's channels, first to last, as the caller sees them.
   * Administrators only. A 409 means the list changed since it was loaded: re-read it.
   */
  async function setChannelOrder(spaceId: string, channelIds: string[]): Promise<void> {
    await apiPut<void>(`/organisations/${spaceId}/channel-order`, { channel_ids: channelIds });
  }

  /** Choose the public channel every newly invited person joins. Space administrators may change it. */
  async function setDefaultChannel(spaceId: string, channelId: string): Promise<SpaceIdentity> {
    const dto = await apiPut<{ id: string; name: string; slug: string; icon_url: string | null; default_channel_id?: string }>(
      `/organisations/${spaceId}/default-channel`,
      { channel_id: channelId },
    );
    return { id: dto.id, name: dto.name, slug: dto.slug, iconUrl: dto.icon_url ?? undefined, defaultChannelId: dto.default_channel_id };
  }

  /** `GET /organisations/{id}/channels`: the channels the caller can see in a space. */
  async function getChannels(spaceId: string, signal?: AbortSignal): Promise<Channel[]> {
    const channels = await apiGet<ChannelDto[]>(`/organisations/${spaceId}/channels`, signal);
    return channels.map(toChannel);
  }

  /**
   * `POST /organisations/{id}/channels`: create a channel, owned by the caller. The server normalises the
   * name into a handle (lowercase, accents folded, dashes), so the channel comes back under the name
   * it will keep, which may differ from what was typed.
   */
  async function createChannel(
    spaceId: string,
    channel: { name: string; type: ChannelType; topic?: string; allowedRoles?: string[] },
  ): Promise<Channel> {
    const dto = await apiPost<ChannelDto>(`/organisations/${spaceId}/channels`, {
      name: channel.name,
      type: channel.type,
      topic: channel.topic,
      // Absent leaves the channel open to every role; an empty list says the same thing, which is what
      // an empty selection means on screen.
      allowed_roles: channel.allowedRoles,
    });
    return toChannel(dto);
  }

  /**
   * `PUT /channels/{id}/favorite`: pin a channel to the caller's own favourites, or unpin it.
   *
   * Per caller: a favourite is one person's shortcut and is invisible to everyone else.
   */
  async function setChannelFavorite(channelId: string, favorite: boolean): Promise<void> {
    await apiPut<void>(`/channels/${channelId}/favorite`, { favorite });
  }

  /**
   * `DELETE /channels/{id}`: delete a channel and everything said in it, for everyone. Space owners
   * and administrators only; a `409` means it is the space's default channel.
   */
  async function deleteChannel(channelId: string): Promise<void> {
    await apiDelete<void>(`/channels/${channelId}`);
  }

  /**
   * `PATCH /channels/{id}`: rename a channel, set its topic, or change its visibility. Archiving is
   * `type: "archived"`, which makes the channel read-only without deleting anything.
   */
  async function updateChannel(
    channelId: string,
    patch: { name?: string; type?: ChannelType; topic?: string; allowedRoles?: string[] },
  ): Promise<Channel> {
    const dto = await apiPatch<ChannelDto>(`/channels/${channelId}`, {
      name: patch.name,
      type: patch.type,
      topic: patch.topic,
      allowed_roles: patch.allowedRoles,
    });
    return toChannel(dto);
  }

  /** `PUT /channels/{id}/membership`: join a public channel. Idempotent. */
  async function joinChannel(channelId: string): Promise<void> {
    await apiPut<void>(`/channels/${channelId}/membership`);
  }

  /** `DELETE /channels/{id}/membership`: leave a channel. Only the caller's membership is removed. */
  async function leaveChannel(channelId: string): Promise<void> {
    await apiDelete<void>(`/channels/${channelId}/membership`);
  }

  /** `GET /organisations/{id}/dms`: the caller's direct-message conversations in a space. */
  async function getDirectMessages(spaceId: string, signal?: AbortSignal): Promise<DirectMessage[]> {
    const dms = await apiGet<DirectMessageDto[]>(`/organisations/${spaceId}/dms`, signal);
    return dms.map(toDirectMessage);
  }

  /** `GET /organisations/{id}/members`: the members of a space (member list, mentions, people search). */
  async function getSpaceMembers(spaceId: string, signal?: AbortSignal): Promise<Member[]> {
    const rows = await apiGet<MemberDto[]>(`/organisations/${spaceId}/members`, signal);
    return rows.map(toMember);
  }

  /**
   * `GET /channels/{id}/members`: who is actually in a channel.
   *
   * Not the same set as the space's members, which is what the member panel and the add-people dialog
   * were both showing: a private channel holds a subset, and anyone can leave a public one.
   */
  async function listChannelMembers(channelId: string, signal?: AbortSignal): Promise<Member[]> {
    const rows = await apiGet<MemberDto[]>(`/channels/${channelId}/members`, signal);
    return rows.map((m) => ({
      userId: m.user_id,
      name: m.display_name,
      role: m.role,
      title: m.title,
      bot: m.is_bot,
      avatarUrl: m.avatar_url,
    }));
  }

  /**
   * `POST /channels/{id}/members`: bring other people into a channel.
   *
   * Resolves to whoever was actually added: anyone already in the channel is skipped rather than
   * refused, since the outcome asked for is already true of them.
   */
  async function addChannelMembers(channelId: string, userIds: string[]): Promise<string[]> {
    const dto = await apiPost<{ added: string[] }>(`/channels/${channelId}/members`, { user_ids: userIds });
    return dto.added;
  }

  /**
   * `PATCH /channels/{id}/members/{userId}`: say what someone may do inside a channel.
   *
   * The channel's own ladder (`member` < `admin` < `owner`), under the rule the space roles use: only
   * below your own rank, on someone below it. A space administrator counts as the channel's owner.
   */
  async function setChannelMemberRole(
    channelId: string,
    userId: string,
    role: string,
  ): Promise<string> {
    const dto = await apiPatch<{ role: string }>(`/channels/${channelId}/members/${userId}`, { role });
    return dto.role;
  }

  /** `DELETE /channels/{id}/members/{userId}`: take someone out of a channel. Same rank rule. */
  async function removeChannelMember(channelId: string, userId: string): Promise<void> {
    await apiDelete<void>(`/channels/${channelId}/members/${userId}`);
  }

  /** `POST /organisations/{id}/dm`: open (or fetch) a direct message with a set of users; returns its id. */
  async function createDm(spaceId: string, userIds: string[]): Promise<string> {
    const ref = await apiPost<{ id: string }>(`/organisations/${spaceId}/dm`, { user_ids: userIds });
    return ref.id;
  }

  // --- Messages ---

  /** `GET /conversations/{id}/messages`: a page of a conversation's feed (newest last). */
  async function getChannelMessages(
    conversationId: string,
    opts: { before?: string; limit?: number } = {},
    signal?: AbortSignal,
  ): Promise<MessagePage> {
    const params = new URLSearchParams();
    if (opts.before) params.set("before", opts.before);
    if (opts.limit) params.set("limit", String(opts.limit));
    const query = params.toString();
    const page = await apiGet<MessagePageDto>(
      `/conversations/${conversationId}/messages${query ? `?${query}` : ""}`,
      signal,
    );
    return { messages: page.messages.map(toMessage), nextBefore: page.next_before };
  }

  /**
   * `GET /organisations/{id}/changes`: messages created, edited, deleted (tombstones) or reacted to since
   * `since`, in every conversation of the space the caller can see, thread replies included. Without
   * `since`, only the cursor, which is how a client starts counting.
   */
  async function getChanges(spaceId: string, since?: string, signal?: AbortSignal): Promise<SpaceChanges> {
    const query = since ? `?since=${encodeURIComponent(since)}` : "";
    const dto = await apiGet<{ now: string; messages: MessageDto[]; truncated: boolean }>(
      `/organisations/${spaceId}/changes${query}`,
      signal,
    );
    return {
      now: dto.now,
      changes: dto.messages.map((m) => ({ conversationId: m.conversation_id, message: toMessage(m) })),
      truncated: dto.truncated,
    };
  }

  /** `POST /conversations/{id}/messages`: post a message (optionally a threaded reply). */
  async function sendMessage(
    conversationId: string,
    body: string,
    opts: { attachments?: string[]; parentMessageId?: string; alsoInChannel?: boolean } = {},
  ): Promise<ApiMessage> {
    const dto = await apiPost<MessageDto>(`/conversations/${conversationId}/messages`, {
      body,
      attachments: opts.attachments ?? [],
      parent_message_id: opts.parentMessageId,
      // Sent only when asked: an older instance ignores it, a newer one reads false as absent.
      ...(opts.parentMessageId && opts.alsoInChannel ? { also_in_channel: true } : {}),
    });
    return toMessage(dto);
  }

  /** `PATCH /messages/{id}`: edit a message's body and optionally add uploaded files. */
  async function editMessage(messageId: string, body: string, attachments: string[] = []): Promise<ApiMessage> {
    return toMessage(await apiPatch<MessageDto>(`/messages/${messageId}`, { body, attachments }));
  }

  /** `DELETE /messages/{id}`: soft-delete a message, returning its tombstone. */
  async function deleteMessage(messageId: string): Promise<ApiMessage> {
    return toMessage(await apiDelete<MessageDto>(`/messages/${messageId}`));
  }

  /** `GET /messages/{id}/replies`: the messages in a thread, oldest first. */
  async function getReplies(messageId: string, signal?: AbortSignal): Promise<ApiMessage[]> {
    const replies = await apiGet<MessageDto[]>(`/messages/${messageId}/replies`, signal);
    return replies.map(toMessage);
  }

  /** `PUT /messages/{id}/reactions/{emoji}`: add the caller's reaction. */
  async function addReaction(messageId: string, emoji: string): Promise<void> {
    await apiPut<void>(`/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`);
  }

  /** `DELETE /messages/{id}/reactions/{emoji}`: remove the caller's reaction. */
  async function removeReaction(messageId: string, emoji: string): Promise<void> {
    await apiDelete<void>(`/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`);
  }

  /** `PUT /conversations/{id}/read`: advance the caller's read cursor to a message. */
  async function setReadCursor(conversationId: string, lastReadMessageId: string): Promise<void> {
    await apiPut<void>(`/conversations/${conversationId}/read`, { last_read_message_id: lastReadMessageId });
  }

  /**
   * `GET /me/saved`: every message the caller has bookmarked, newest first.
   *
   * The whole account, not the space on screen. The view used to filter the messages held in memory,
   * which meant a bookmark kept its promise only until the conversation moved on or the reader
   * switched space, and surviving both is the point of a bookmark.
   */
  async function getSavedMessages(signal?: AbortSignal): Promise<SavedMessage[]> {
    const rows = await apiGet<(MessageDto & { space_id: string; space_name: string; channel_name?: string })[]>(
      "/me/saved",
      signal,
    );
    return rows.map((row) => ({
      message: toMessage(row),
      conversationId: row.conversation_id,
      spaceId: row.space_id,
      spaceName: row.space_name,
      channelName: row.channel_name,
    }));
  }

  /** `PUT|DELETE /messages/{id}/save`: bookmark or un-bookmark a message. */
  async function setMessageSaved(messageId: string, saved: boolean): Promise<void> {
    if (saved) await apiPut<void>(`/messages/${messageId}/save`);
    else await apiDelete<void>(`/messages/${messageId}/save`);
  }

  /**
   * `GET /channels/{id}/pins`: every pinned message of a channel, newest first.
   *
   * Asked for rather than filtered out of what is on screen: a pin is meant to survive the
   * conversation moving on, so the one that matters is usually older than the page in memory, and
   * deriving the panel from the loaded messages hid exactly the pins worth keeping.
   */
  async function getPinnedMessages(channelId: string, signal?: AbortSignal): Promise<ApiMessage[]> {
    const rows = await apiGet<MessageDto[]>(`/channels/${channelId}/pins`, signal);
    return rows.map(toMessage);
  }

  /** `PUT|DELETE /channels/{channelId}/pins/{messageId}`: pin or unpin a message in a channel. */
  async function setMessagePinned(channelId: string, messageId: string, pinned: boolean): Promise<void> {
    if (pinned) await apiPut<void>(`/channels/${channelId}/pins/${messageId}`);
    else await apiDelete<void>(`/channels/${channelId}/pins/${messageId}`);
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

  // --- Notifications ---

  /**
   * `GET /conversations/{id}/read`: how far each member has read.
   *
   * One cursor per person, not a receipt per message: combined with the order of the messages it
   * answers the same question, which is who has seen a given one.
   */
  async function getReadCursors(conversationId: string, signal?: AbortSignal): Promise<ReadCursor[]> {
    const rows = await apiGet<{ user_id: string; last_read_message_id?: string }[]>(
      `/conversations/${conversationId}/read`,
      signal,
    );
    return rows.map((r) => ({ userId: r.user_id, lastReadMessageId: r.last_read_message_id }));
  }

  /** `PUT /me/dms/{id}/hidden`: hide a direct conversation from the person's own list, or bring it back. */
  async function setDmHidden(dmId: string, hidden: boolean): Promise<void> {
    await apiPut<void>(`/me/dms/${dmId}/hidden`, { hidden });
  }

  /** `GET /me/notification-preferences`. */
  /**
   * The emoji the signed-in person reacted with last, newest first (`recent_reactions`): the quick
   * reactions lead with them. Empty on an instance without the feature, as for someone who never
   * reacted.
   */
  async function getRecentReactions(signal?: AbortSignal): Promise<string[]> {
    const dto = await apiGet<{ emojis?: unknown }>("/me/recent-reactions", signal);
    return Array.isArray(dto.emojis) ? dto.emojis.filter((e): e is string => typeof e === "string") : [];
  }

  /** `PUT /conversations/{id}/notification-preference`: how much one channel or DM notifies the caller. */
  async function saveConversationNotify(conversationId: string, notify: ConversationNotify): Promise<void> {
    await apiPut<void>(`/conversations/${conversationId}/notification-preference`, notify);
  }

  // --- Search ---


  return {
    setChannelOrder, getChannels, createChannel, setChannelFavorite, deleteChannel, updateChannel, joinChannel, leaveChannel, getDirectMessages, listChannelMembers, addChannelMembers, setChannelMemberRole, removeChannelMember, createDm, sendMessage, editMessage, deleteMessage, getReplies, addReaction, removeReaction, setReadCursor, setMessageSaved, getPinnedMessages, setMessagePinned, setDmHidden, getRecentReactions, saveConversationNotify, getChannelMessages, getChanges, getSavedMessages, getReadCursors, getSpaceMembers, setDefaultChannel,
  };
}

export type ChatApi = ReturnType<typeof createChatApi>;
