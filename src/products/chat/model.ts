/**
 * The chat's messages as the screens hold them, from the chat's `MessageDto` (`contract/openapi-v1.json`
 * of Ruchoir/chat). Pure: the chat's API and the hub's live frames (`chat.message.*`) both map here.
 */
import type { EventCard } from "../shared/calendarModel.ts";
import { iconForSystemEvent, isSystemEvent, toReaction } from "../shared/model.ts";
import type { ApiMessage, AttachmentDto, MessageCardDto, MessageDto } from "../shared/model.ts";
import type { InlineImage, MessageAttachment, MessageKind } from "../shared/types.ts";

/**
 * The size an image is laid out at before it loads: the chat does not say an image's size, so the
 * thumbnail's box keeps a common 4:3 ratio rather than collapsing.
 */
const IMAGE_BOX = { width: 4, height: 3 };

/** A drive address with the message's grant, which the drive takes as a query parameter. */
function withGrant(url: string | null | undefined, grant: string | null | undefined): string | undefined {
  if (!url) return undefined;
  if (!grant) return url;
  return `${url}${url.includes("?") ? "&" : "?"}grant=${encodeURIComponent(grant)}`;
}

/** The icon of a file, from its media type (`attachmentIcon`'s names). */
export function iconForMime(mime: string): string {
  if (mime.startsWith("text/") || mime === "application/pdf" || mime.includes("wordprocessing") || mime.includes("opendocument.text")) {
    return "file-text";
  }
  if (mime.includes("spreadsheet") || mime === "text/csv") return "file-spreadsheet";
  return "file";
}

/** A calendar card as the chat carries it. The chat does not say whether the event repeats. */
export function toCard(dto: MessageCardDto): EventCard {
  return {
    eventId: dto.event_id,
    title: dto.title,
    start: dto.starts_at,
    end: dto.ends_at,
    allDay: dto.all_day,
    location: dto.location ?? undefined,
    recurring: false,
  };
}

/**
 * A message's files, in their order, with the first-item aliases compact views use. An image goes
 * inline when the drive gave it an address to show; anything else is a file to open.
 */
export function splitAttachments(attachments: AttachmentDto[]): {
  attachment?: MessageAttachment;
  attachments?: MessageAttachment[];
  image?: InlineImage;
  images?: InlineImage[];
} {
  const attachmentsOut: MessageAttachment[] = [];
  const imagesOut: InlineImage[] = [];
  for (const a of [...attachments].sort((x, y) => x.position - y.position)) {
    const url = withGrant(a.download_url, a.grant);
    const previewUrl = withGrant(a.preview_url, a.grant);
    const thumbnail = withGrant(a.thumbnail_url, a.grant) ?? previewUrl;
    if (a.mime_type.startsWith("image/") && thumbnail) {
      imagesOut.push({
        fileId: a.file_id,
        alt: a.alt_text ?? a.name,
        name: a.name,
        ...IMAGE_BOX,
        src: thumbnail,
        downloadUrl: url,
      });
    } else {
      attachmentsOut.push({
        fileId: a.file_id,
        name: a.name,
        sizeBytes: a.size_bytes,
        kind: iconForMime(a.mime_type),
        url,
        previewUrl,
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

/** A message of the chat. */
export function toMessage(dto: MessageDto): ApiMessage {
  const { attachment, attachments, image, images } = splitAttachments(dto.attachments);
  const link = dto.link_preview;
  const systemEvent = dto.system_event ?? undefined;
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
      dto.kind === "system" && isSystemEvent(systemEvent)
        ? { event: systemEvent, actor: dto.author_name ?? "", detail: dto.body || undefined }
        : undefined,
    systemIcon: dto.kind === "system" ? iconForSystemEvent(systemEvent) : undefined,
    eventCard: dto.card ? toCard(dto.card) : undefined,
    attachment,
    attachments,
    image,
    images,
    reactions: dto.reactions.length > 0 ? dto.reactions.map(toReaction) : undefined,
    parentId: dto.parent_message_id ?? undefined,
    alsoInChannel: dto.also_in_channel || undefined,
    threadRoot: dto.thread_root
      ? { id: dto.thread_root.id, authorName: dto.thread_root.author_name ?? undefined, excerpt: dto.thread_root.excerpt }
      : undefined,
    replies: dto.reply_count > 0 ? dto.reply_count : undefined,
    replyAuthors: dto.reply_authors?.length ? dto.reply_authors : undefined,
    lastReplyAt: dto.last_reply_at ?? undefined,
    imported: dto.imported || undefined,
    pinned: dto.pinned || undefined,
    pinnedBy: dto.pinned_by ?? undefined,
    edited: dto.edited || undefined,
    editedAt: dto.edited_at ?? undefined,
    deleted: dto.deleted || undefined,
    saved: dto.saved || undefined,
    link: link
      ? {
          url: link.url,
          domain: link.domain,
          title: link.title ?? undefined,
          description: link.description ?? undefined,
          // Only a plain hex colour reaches a style attribute.
          color: link.color && /^#[0-9a-f]{6}$/i.test(link.color) ? link.color : undefined,
          imageUrl: link.image_url ?? undefined,
          imageWidth: link.image_width ?? undefined,
          imageHeight: link.image_height ?? undefined,
        }
      : undefined,
  };
}
