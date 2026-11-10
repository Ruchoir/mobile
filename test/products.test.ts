import { test } from "node:test";
import assert from "node:assert/strict";

import { toNotification, type InboxEntryDto } from "../src/products/hub/inbox.ts";
import { domainOf } from "../src/session/server.ts";

const entry = (over: Partial<InboxEntryDto>): InboxEntryDto => ({
  id: "e1",
  product: "chat",
  kind: "mention",
  category: "mentions",
  object: "m1",
  organisation: "o1",
  actor: "u2",
  link: "/c/c1",
  variables: { conversation_id: "c1", message_id: "m1", channel_name: "général", actor_name: "Léa", body: "salut" },
  created_at: "2026-11-10T10:00:00Z",
  read_at: null,
  ...over,
});

test("a_chat_entry_of_the_hub_reads_as_the_notification_rows_expect", () => {
  const n = toNotification(entry({}));
  assert.equal(n.kind, "mention");
  assert.equal(n.conversationId, "c1");
  assert.equal(n.spaceId, "o1");
  assert.equal(n.actor, "Léa");
  assert.equal(n.preview, "salut");
  assert.equal(n.read, false);
});

test("a_calendar_kind_is_named_with_its_product_and_an_unknown_kind_is_a_message", () => {
  assert.equal(toNotification(entry({ product: "calendar", kind: "reminder", variables: {} })).kind, "calendar_reminder");
  assert.equal(toNotification(entry({ kind: "something_new", read_at: "2026-11-10T11:00:00Z" })).kind, "message");
  assert.equal(toNotification(entry({ read_at: "2026-11-10T11:00:00Z" })).read, true);
});

test("the_domain_is_read_from_the_address_or_the_hub", () => {
  assert.equal(domainOf("https://example.org"), "example.org");
  assert.equal(domainOf("https://hub.example.org"), "example.org");
});
