import { test } from "node:test";
import assert from "node:assert/strict";

import { dispatchFrame } from "../src/products/hub/live.ts";
import { toMessage } from "../src/products/chat/model.ts";
import type { MessageDto } from "../src/products/shared/model.ts";

const message: MessageDto = {
  id: "m1",
  conversation_id: "c1",
  author_id: "u1",
  author_name: "Ada",
  kind: "message",
  body: "Hello",
  also_in_channel: false,
  reply_count: 0,
  imported: false,
  edited: false,
  deleted: false,
  pinned: false,
  saved: false,
  created_at: "2026-11-10T08:00:00Z",
  reactions: [],
  mentions: [],
  attachments: [
    { file_id: "f2", name: "notes.pdf", mime_type: "application/pdf", size_bytes: 10, position: 1, download_url: "https://drive.example.org/api/v1/files/f2/download", grant: "g" },
    { file_id: "f1", name: "cat.png", mime_type: "image/png", size_bytes: 5, position: 0, thumbnail_url: "https://drive.example.org/api/v1/files/f1/thumbnail", grant: "g" },
  ],
  card: { product: "calendar", event_id: "e1", title: "Standup", starts_at: "2026-11-10T09:00:00Z", ends_at: "2026-11-10T09:15:00Z", all_day: false, link: "https://calendar.example.org/e/e1" },
  link_preview: { id: "p1", url: "https://example.org", domain: "example.org", color: "#ff0000" },
};

test("a_chat_message_maps_its_files_card_and_preview", () => {
  const m = toMessage(message);
  assert.equal(m.images?.[0]?.fileId, "f1");
  assert.equal(m.images?.[0]?.src, "https://drive.example.org/api/v1/files/f1/thumbnail?grant=g");
  assert.equal(m.attachments?.[0]?.kind, "file-text");
  assert.equal(m.eventCard?.start, "2026-11-10T09:00:00Z");
  assert.equal(m.link?.color, "#ff0000");
});

test("a_chat_frame_reaches_its_handler_with_its_scope", () => {
  let seen: [string, string] | null = null;
  dispatchFrame({ v: 1, type: "chat.message.created", scope: "c1", payload: message }, {
    onMessageCreated: (conversation, m) => {
      seen = [conversation, m.id];
    },
  });
  assert.deepEqual(seen, ["c1", "m1"]);
});

test("the_hubs_own_frames_are_read", () => {
  const events: string[] = [];
  const handlers = {
    onNotification: (a: { category: string }) => events.push(`new:${a.category}`),
    onNotificationsRead: (r: { unreadCount?: number }) => events.push(`read:${r.unreadCount}`),
    onPresence: (account: string) => events.push(`presence:${account}`),
    onFilesUpdated: (organisation: string) => events.push(`files:${organisation}`),
    onCalendarChanged: (id: string) => events.push(`calendar:${id}`),
  };
  dispatchFrame({ v: 1, type: "hub.inbox.new", payload: { kind: "chat.mention", category: "mention", organisation: "o1" } }, handlers);
  dispatchFrame({ v: 1, type: "hub.inbox.read", payload: { ids: ["a"], all: false, unread_count: 2 } }, handlers);
  dispatchFrame({ v: 1, type: "hub.presence.changed", payload: { account: "u2", presence: "away" } }, handlers);
  dispatchFrame({ v: 1, type: "drive.files.updated", payload: { organisation: "o1", folder: null, files: [] } }, handlers);
  dispatchFrame({ v: 1, type: "calendar.changed", payload: { calendar_id: "k1" } }, handlers);
  dispatchFrame({ v: 1, type: "message.created", payload: {} }, handlers);
  assert.deepEqual(events, ["new:mention", "read:2", "presence:u2", "files:o1", "calendar:k1"]);
});
