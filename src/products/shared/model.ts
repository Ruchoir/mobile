/**
 * The fetch-backed implementation of the data seam.
 *
 * This is where the real Rust API is translated into the domain shapes the UI consumes
 * (`lib/data/types.ts`). Every function here is a thin, typed wrapper over {@link apiRequest}: it
 * calls one endpoint and maps its DTO (snake_case, UUIDs, RFC 3339 timestamps, raw byte sizes) into
 * the front shape (camel/display fields). The mock seam (`lib/data/index.ts`) is being replaced by
 * these, screen by screen, so the mapping lives in one auditable place.
 *
 * It covers auth (sign-in, registration, email verification, password reset and the second-factor
 * step-up), the space and channel lifecycle, and the space bootstrap, member profiles, the message operations, files, search,
 * the notification feed and the realtime channel (`connectRealtime`). Message ids are UUID strings;
 * `ApiMessage` is the front `Message` with that string id.
 */
import { ApiError } from "./http.ts";
import type { AccountPrefsDoc } from "./accountPrefs.ts";
import type {
  AccessChange,
  AccessKind,
  AccessLevel,
  AccessTarget,
  AccessTargetKind,
  AccessView,
  NamedRef,
  UsedIn,
  WhyView,
  LicenceMode,
  LicenceStatus,
  LicenceView,
  Refusal,
  Role,
  Group,
  Channel,
  ChannelType,
  ConversationNotify,
  NotifyLevel,
  DirectMessage,
  FileEditor,
  ImportSource,
  Invitation,
  LastMessage,
  InvitationStatus,
  Message,
  OfficeCapabilities,
  OfficeMode,
  PresenceChoice,
  Reaction,
  SpaceFile,
  SystemEvent,
  Presence,
  Workspace,
} from "./types.ts";

// --- Raw API DTOs (mirror the Rust structs; snake_case, as sent on the wire) ---

/** The signed-in user, from `POST /auth/login`, `POST /auth/register` and `GET /auth/session`. */
export type UserSummaryDto = {
  id: string;
  email: string;
  display_name: string;
  active: boolean;
  /** The caller's own availability choice; absent means automatic. Never sent for anyone else. */
  manual_presence?: string;
  /** Whether this account administers the instance. */
  is_instance_admin?: boolean;
  timezone?: string;
  locale?: string;
};

/** Alternative login outcome when a second factor is required (same 200 status as a success). */
export type MfaRequiredDto = { mfa_required: true; methods: string[]; mfa_token: string };

export type SpaceDto = {
  id: string;
  name: string;
  slug: string;
  role: string;
  members: number;
  unread: number;
  mentions: number;
  icon_url?: string;
  default_channel_id?: string;
  notify_level?: string;
  my_permissions?: string[];
  edition?: string;
  licence?: { seats: number; used: number; valid_until: string; expires_in_days: number };
  expires_at?: string | null;
  preview?: { role_id: string; role_name: string; idle_seconds?: number } | null;
};

export type RoleDto = {
  id: string;
  system_key?: "administrator" | "members" | "guests";
  name: string;
  colour?: string;
  position: number;
  permissions: string[];
  holders: number;
  manageable: boolean;
};

export type GroupDto = {
  id: string;
  name: string;
  description?: string | null;
  source: string;
  member_ids: string[];
  manager_ids: string[];
  role_ids: string[];
  imported_from?: string | null;
  may: { edit: boolean; delete: boolean; change_members: boolean; change_roles: boolean; appoint: boolean; add_needs_licence: boolean; add_people_needs_licence: boolean };
};

export function toGroup(dto: GroupDto): Group {
  return {
    id: dto.id,
    name: dto.name,
    description: dto.description || undefined,
    source: dto.source === "directory" ? "directory" : "manual",
    memberIds: dto.member_ids,
    managerIds: dto.manager_ids,
    roleIds: dto.role_ids,
    ...(dto.imported_from ? { importedFrom: dto.imported_from } : {}),
    may: {
      edit: dto.may.edit,
      delete: dto.may.delete,
      changeMembers: dto.may.change_members,
      changeRoles: dto.may.change_roles,
      appoint: dto.may.appoint,
      addNeedsLicence: dto.may.add_needs_licence,
      addPeopleNeedsLicence: dto.may.add_people_needs_licence,
    },
  };
}

export type AuditEntryDto = {
  id: string;
  at: string;
  action: string;
  category: string;
  actor: { id: string; display_name: string; avatar_url?: string } | null;
  target: { kind: string; id?: string; label?: string };
  details: Record<string, unknown>;
};

export type LicenceViewDto = {
  licence_id: string;
  organisation: string;
  seats: number;
  used: number;
  valid_until: string;
  edition: "enterprise" | "frozen" | "community";
  installed_at?: string;
  installed_by?: { id: string; display_name: string } | null;
  mode?: LicenceMode | null;
  status?: LicenceStatus;
  last_check_in_at?: string | null;
  unreachable_since?: string | null;
  next?: { valid_from: string; valid_until: string; seats: number } | null;
};

export type AdminLicenceDto = {
  space_id: string;
  space_name: string;
  organisation: string;
  seats: number;
  used: number;
  valid_until: string;
  edition: "enterprise" | "frozen" | "community" | "invalid";
  mode?: LicenceMode | null;
  status?: LicenceStatus | "invalid";
  last_check_in_at?: string | null;
};

export function toRole(dto: RoleDto): Role {
  return {
    id: dto.id,
    systemKey: dto.system_key,
    name: dto.name,
    colour: dto.colour,
    position: dto.position,
    permissions: dto.permissions,
    holders: dto.holders,
    manageable: dto.manageable,
  };
}

export function toLicenceView(dto: LicenceViewDto): LicenceView {
  return {
    licenceId: dto.licence_id,
    organisation: dto.organisation,
    seats: dto.seats,
    used: dto.used,
    validUntil: dto.valid_until,
    edition: dto.edition,
    installedAt: dto.installed_at || undefined,
    installedBy: dto.installed_by ? { id: dto.installed_by.id, name: dto.installed_by.display_name } : undefined,
    mode: dto.mode ?? undefined,
    status: dto.status,
    lastCheckInAt: dto.last_check_in_at ?? undefined,
    unreachableSince: dto.unreachable_since ?? undefined,
    next: dto.next ? { validFrom: dto.next.valid_from, validUntil: dto.next.valid_until, seats: dto.next.seats } : undefined,
  };
}

export type NamedRefDto = { kind: string; id?: string | null; name?: string | null; hidden?: boolean | null };
export type UsedInDto = { kind: string; id?: string | null; name?: string | null; hidden?: boolean | null; level?: string | null; parent_id?: string | null };
export type AccessEntryDto = {
  id?: string | null;
  target: NamedRefDto;
  level: string;
  allow: string[];
  deny: string[];
  clamped: boolean;
  guest: boolean;
  inherited_from?: NamedRefDto | null;
  summary?: { nearest: string; changes: { permission: string; state: string }[] } | null;
  via_legacy: boolean;
  set_by?: { id: string; name: string } | null;
  set_at?: string | null;
};
export type AccessDto = {
  resource: { kind: string; id: string; name: string; parent?: NamedRefDto | null };
  private: boolean;
  archived: boolean;
  entries: AccessEntryDto[];
  may: { edit: boolean; fine: boolean; manage_target_levels: string[]; held?: string[]; reason?: string | null };
};
export type WhyRoleDto = { id: string; name: string; direct: boolean; via_groups: { id: string; name: string }[] };
export type WhyDto = {
  person: { id: string; name: string; standing: string; roles?: WhyRoleDto[] };
  steps: {
    n: number;
    kind: string;
    permission: string;
    effect: string;
    role?: WhyRoleDto | null;
    target?: NamedRefDto | null;
    level?: NamedRefDto | null;
    rule_level?: string | null;
  }[];
  result: { permission: string; granted: boolean; reason?: { n: number } | null }[];
};

export function toNamedRef(dto: NamedRefDto): NamedRef {
  return { kind: dto.kind, id: dto.id ?? undefined, name: dto.name ?? undefined, hidden: dto.hidden === true };
}

export function toAccessTarget(dto: NamedRefDto): AccessTarget {
  return { ...toNamedRef(dto), kind: dto.kind as AccessTargetKind };
}

/** A level from the wire; one this app does not know reads as `custom`, which it only displays. */
export function toAccessLevel(level: string): AccessLevel {
  return level === "none" || level === "read" || level === "contribute" || level === "manage" ? level : "custom";
}

export function toAccessView(dto: AccessDto): AccessView {
  return {
    resource: {
      kind: dto.resource.kind as AccessKind,
      id: dto.resource.id,
      name: dto.resource.name,
      parent: dto.resource.parent ? toNamedRef(dto.resource.parent) : undefined,
    },
    private: dto.private,
    archived: dto.archived,
    entries: dto.entries.map((e) => ({
      id: e.id ?? undefined,
      target: toAccessTarget(e.target),
      level: toAccessLevel(e.level),
      allow: e.allow,
      deny: e.deny,
      clamped: e.clamped,
      guest: e.guest,
      inheritedFrom: e.inherited_from ? toNamedRef(e.inherited_from) : undefined,
      summary: e.summary
        ? {
            nearest: toAccessLevel(e.summary.nearest),
            changes: e.summary.changes.map((c) => ({ permission: c.permission, state: c.state as AccessChange["state"] })),
          }
        : undefined,
      viaLegacy: e.via_legacy,
      setBy: e.set_by ? { id: e.set_by.id, name: e.set_by.name } : undefined,
      setAt: e.set_at ?? undefined,
    })),
    may: {
      edit: dto.may.edit,
      fine: dto.may.fine,
      manageTargetLevels: dto.may.manage_target_levels.map(toAccessLevel),
      held: dto.may.held ?? [],
      reason: dto.may.reason ?? undefined,
    },
  };
}

export function toWhyView(dto: WhyDto): WhyView {
  return {
    person: {
      id: dto.person.id,
      name: dto.person.name,
      standing: dto.person.standing,
      roles: (dto.person.roles ?? []).map((r) => ({ id: r.id, name: r.name, direct: r.direct, viaGroups: r.via_groups })),
    },
    steps: dto.steps.map((s) => ({
      n: s.n,
      kind: s.kind,
      permission: s.permission,
      effect: s.effect === "removed" ? "removed" : "granted",
      role: s.role ? { id: s.role.id, name: s.role.name, direct: s.role.direct, viaGroups: s.role.via_groups } : undefined,
      target: s.target ? toAccessTarget(s.target) : undefined,
      level: s.level ? toNamedRef(s.level) : undefined,
      ruleLevel: s.rule_level ? toAccessLevel(s.rule_level) : undefined,
    })),
    result: dto.result.map((r) => ({ permission: r.permission, granted: r.granted, reasonStep: r.reason?.n })),
  };
}

export function toUsedIn(dto: UsedInDto): UsedIn {
  return {
    kind: dto.kind as UsedIn["kind"],
    id: dto.id ?? undefined,
    name: dto.name ?? undefined,
    hidden: dto.hidden === true,
    level: dto.level ? toAccessLevel(dto.level) : undefined,
    parentId: dto.parent_id ?? undefined,
  };
}

export { isBackgroundWrite } from "./background.ts";

export const REFUSAL_CODES = new Set([
  "cannot_grant", "target_above_you", "reservation_admins_only", "guest_ceiling", "audience_files_only",
  "base_role_not_previewable", "base_role_levels_only", "permission_in_both", "unknown_permission", "wrong_family", "group_has_rules",
  "preview_read_only", "preview_unavailable",
  "seats_full", "licence_required", "licence_frozen", "licence_invalid", "licence_other_space",
  "licence_expired", "licence_service_unreachable", "licence_check_too_soon", "role_above_you", "person_above_you", "permission_not_held",
  "role_name_reserved", "role_name_taken", "role_has_rules", "beyond_guest_ceiling",
  "make_them_a_member_first", "no_self_role", "manager_protected", "group_from_directory",
  "group_name_taken", "group_name_reserved", "group_name_invalid", "manager_must_be_member",
  "base_role_not_allowed", "not_in_space", "too_many_people", "bad_expiry", "guest_only", "access_ended", "not_ended",
  "access_ended_for_good", "rate_limited",
]);

/**
 * The named refusal an API error carries (`error`, or for a `403` its `reason`), or `undefined` when
 * it is not one this app knows: the screen then says what it says for any failure.
 */
export function refusalOf(err: unknown): Refusal | undefined {
  if (!(err instanceof ApiError)) return undefined;
  const body = (err.body ?? {}) as { error?: string; reason?: string; seats?: number; pricing_url?: string; organisation?: string; used_in?: UsedInDto[]; space?: string; used?: number; incoming?: number; missing?: number };
  const code = body.error === "forbidden" ? body.reason : body.error;
  if (!code || !REFUSAL_CODES.has(code)) return undefined;
  if (code === "seats_full") {
    const refusal: Refusal = { code, seats: body.seats ?? 0, pricingUrl: body.pricing_url ?? "" };
    // The import's refusal says more than the others: which space, and by how many places.
    if (typeof body.missing === "number") {
      return { ...refusal, space: body.space, used: body.used ?? 0, incoming: body.incoming ?? 0, missing: body.missing };
    }
    return refusal;
  }
  if (code === "licence_required") return { code, pricingUrl: body.pricing_url ?? "" };
  if (code === "licence_other_space") return { code, organisation: body.organisation };
  if (code === "group_has_rules" || code === "role_has_rules") {
    return Array.isArray(body.used_in) ? { code, usedIn: body.used_in.map(toUsedIn) } : { code };
  }
  return { code } as Refusal;
}

export type ChannelDto = {
  id: string;
  name: string;
  type: string;
  topic?: string;
  /** The organisation's default channel, which every newcomer joins. */
  is_default: boolean;
  favorite: boolean;
  notify_level?: string;
  muted?: boolean;
  member: boolean;
  unread: number;
  allowed_roles?: string[];
  member_count?: number;
  last_message?: LastMessageDto;
  my_permissions?: string[];
};

/** A conversation's latest message (or, in a channel, notice) for a list's preview line. */
export type LastMessageDto = { excerpt: string; mine: boolean; created_at: string; author?: string; system_event?: string };

export type DirectMessageDto = {
  id: string;
  name: string;
  is_group: boolean;
  user_id?: string;
  participant_ids?: string[];
  unread: number;
  notify_level?: string;
  muted?: boolean;
  /** Absent from servers before account preferences: nothing is hidden there. */
  hidden?: boolean;
  last_message?: LastMessageDto;
};

/** The hub's `MemberPresence`. */
export type PresenceDto = { account: string; presence: string };

export type ReactionDto = { emoji: string; count: number; mine: boolean; users: string[] };

/**
 * A file a message carries, as the chat gives it (`AttachmentDto`): held in the drive, read there
 * with the `read` grant the chat drew in the caller's name. Live frames carry no grant: the message
 * is read again (`GET /messages/{id}/attachments`) when its files must open.
 */
export type AttachmentDto = {
  file_id: string;
  name: string;
  mime_type: string;
  size_bytes: number;
  position: number;
  alt_text?: string | null;
  /** The drive's addresses; absent when the chat has no drive. */
  download_url?: string | null;
  preview_url?: string | null;
  thumbnail_url?: string | null;
  /** The drive's `grant` query parameter for these addresses. */
  grant?: string | null;
  grant_expires_at?: string | null;
};

/** A card a product posted into a conversation (`MessageCardDto`): a calendar event, today. */
export type MessageCardDto = {
  product: string;
  event_id: string;
  title: string;
  /** RFC 3339, or `YYYY-MM-DD` for an event lasting whole days. */
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  location?: string | null;
  /** Where the event opens, on the calendar's pages. */
  link: string;
};

/** The chat's `MessageDto`. */
export type MessageDto = {
  id: string;
  conversation_id: string;
  author_id?: string | null;
  author_name?: string | null;
  kind: string;
  body: string;
  system_event?: string | null;
  /** The card a product posted (a `calendar.*` system message). */
  card?: MessageCardDto | null;
  parent_message_id?: string | null;
  also_in_channel: boolean;
  thread_root?: { id: string; author_name?: string | null; excerpt: string } | null;
  reply_count: number;
  /** The server's preview of the first link, once it has read the page. */
  link_preview?: {
    id: string;
    url: string;
    domain: string;
    title?: string | null;
    description?: string | null;
    color?: string | null;
    image_url?: string | null;
    image_width?: number | null;
    image_height?: number | null;
  } | null;
  /** Display names of the last repliers, most recent first. */
  reply_authors?: string[];
  last_reply_at?: string | null;
  imported: boolean;
  edited: boolean;
  deleted: boolean;
  pinned: boolean;
  pinned_by?: string | null;
  saved: boolean;
  created_at: string;
  edited_at?: string | null;
  reactions: ReactionDto[];
  mentions: string[];
  attachments: AttachmentDto[];
};

export type MessagePageDto = { messages: MessageDto[]; next_before?: string };

export type UserProfileDto = {
  avatar_url?: string;
  id: string;
  display_name: string;
  email: string;
  title?: string;
  pronouns?: string;
  timezone?: string;
  bio?: string;
  locale?: string;
  is_bot: boolean;
  is_instance_admin?: boolean;
};

// --- Session / auth ---

/** The signed-in user in the shape the app shell holds it. */
export type SessionUser = {
  id: string;
  email: string;
  name: string;
  presenceChoice: PresenceChoice;
  /** Whether this account administers the instance, which is what opens the recovery screen. */
  isInstanceAdmin: boolean;
  /** The account's timezone; absent when it has never had one. */
  timezone?: string;
  /** The language the account is recorded as reading in; absent until the first sign-in writes it. */
  locale?: string;
  /**
   * The account's photo. Not in the session's answer: an app fills it from the profile, and keeps it
   * current from `member.updated`. Absent means the generated face.
   */
  avatarUrl?: string;
};

/**
 * Outcome of a login attempt: authenticated, or challenged for a second factor. `sessionToken` is
 * there only for a client configured with `sessionDelivery: "token"` (a native app); the web's
 * session is its cookie and it never sees one.
 */
export type LoginResult =
  | { kind: "authenticated"; user: SessionUser; sessionToken?: string }
  | { kind: "mfa"; methods: MfaMethod[]; mfaToken: string };

/** A completed second factor: the account, and the session token when one was asked for. */
export type SignedIn = { user: SessionUser; sessionToken?: string };

/** What a sign-in answers: the account, plus `session_token` for a native app. */
export type SignedInDto = UserSummaryDto & { session_token?: string };

export function toSignedIn(dto: SignedInDto): SignedIn {
  return { user: toSessionUser(dto), sessionToken: dto.session_token };
}

export function toSessionUser(dto: UserSummaryDto): SessionUser {
  return {
    id: dto.id,
    email: dto.email,
    name: dto.display_name,
    presenceChoice: toPresenceChoice(dto.manual_presence),
    isInstanceAdmin: dto.is_instance_admin === true,
    timezone: dto.timezone,
    locale: dto.locale,
  };
}

/** The stored override as the menu names it. Absent, empty or unknown all mean automatic. */
export function toPresenceChoice(manual?: string): PresenceChoice {
  switch (manual) {
    case "dnd":
      return "busy";
    case "away":
      return "away";
    case "invisible":
      return "invisible";
    default:
      return "auto";
  }
}

// --- Account security (second factors, password) ---

/** One registered passkey, as the account screen lists them. */
export type PasskeySummary = { id: string; label?: string; createdAt: string; lastUsedAt?: string };

/** What second factors the account actually holds, as the server knows it. */
export type MfaState = { totpEnabled: boolean; recoveryCodesRemaining: number; passkeys: PasskeySummary[] };

// --- What this instance can do ---

/** What the instance supports, as far as a client needs to know before signing in. */
export type InstanceCapabilities = {
  /** Whether a mail relay is configured. False means every emailed flow is a dead end. */
  emailDelivery: boolean;
  /** Live office editing, when the instance has it. */
  office: OfficeCapabilities;
  /** The largest file an upload accepts, in bytes (absent from an older server: no check). */
  uploadMaxBytes?: number;
  /** Days a removed file stays in the trash (0: until emptied; absent from an older server). */
  trashRetentionDays?: number;
  /** Whether files may be handed out by public link. */
  publicLinks: boolean;
  /** Whether sign-in can hand a native app a session token (false on an instance too old for the apps). */
  nativeSessions: boolean;
  /** The release the instance runs (`v1.2.3`, or `dev`); absent from one older than v0.3.0. */
  version?: string;
  /** The major version of its paths: 1 for `/api/v1` (assumed from an instance that does not say). */
  apiVersion: number;
  /** Where the publisher's prices are, for a paid feature offered to an unlicensed space. */
  pricingUrl?: string;
  /**
   * What it can do beyond every `/api/v1` instance, by name (`apps/api/src/compat.rs`). Ask with
   * `supports` before using what a name stands for, and do without when it is absent: an instance
   * is not always updated when the app is (`docs/api-compatibility.md`).
   */
  features: string[];
};

/** Whether the instance can do what `feature` names (`InstanceCapabilities.features`). */
/**
 * Whether a message belongs in its conversation's feed: a root message, or a thread reply sent to
 * its channel too. Every other reply lives in its thread only.
 */
export function isInFeed(m: { parentId?: string; alsoInChannel?: boolean }): boolean {
  return !m.parentId || !!m.alsoInChannel;
}

export function supports(caps: Pick<InstanceCapabilities, "features">, feature: string): boolean {
  return caps.features.includes(feature);
}

// --- Instance administration ---

/** An account as the recovery screen lists it. */
export type AdminUser = {
  id: string;
  email: string;
  name: string;
  /** `pending`, `active` or `locked`. */
  status: string;
  isInstanceAdmin: boolean;
};

/** What an administrator has decided for the whole instance. */
export type InstanceSettings = {
  /** Whether the interface tells everyone who administers the instance. */
  showInstanceAdmins: boolean;
  /**
   * Whether the instance sends Web Push. Pushes go through the push service of each reader's
   * browser vendor, which the instance does not choose (ADR 0001 of Ruchoir/hub), so an administrator may refuse it.
   */
  webPushEnabled: boolean;
};

export type InstanceSettingsDto = { show_instance_admins: boolean; web_push_enabled: boolean };

export function toInstanceSettings(dto: InstanceSettingsDto): InstanceSettings {
  return { showInstanceAdmins: dto.show_instance_admins, webPushEnabled: dto.web_push_enabled };
}

// --- Second factor at sign-in ---

/**
 * The second factors an account can complete, as listed by an {@link LoginResult} MFA challenge.
 * Unknown values are ignored by the screen rather than rendered as an unusable option.
 */
export type MfaMethod = "totp" | "passkey" | "recovery";

/** The known {@link MfaMethod} values, in the order the challenge screen prefers them. */
export const MFA_METHODS: MfaMethod[] = ["totp", "passkey", "recovery"];

// --- Space bootstrap (workspaces, channels, DMs, presence, profiles) ---

export function toWorkspace(dto: SpaceDto): Workspace {
  return {
    id: dto.id,
    name: dto.name,
    members: dto.members,
    role: dto.role,
    slug: dto.slug,
    unread: dto.unread ?? 0,
    mentions: dto.mentions ?? 0,
    iconUrl: dto.icon_url,
    defaultChannelId: dto.default_channel_id,
    notifyLevel: toNotifyLevel(dto.notify_level),
    myPermissions: dto.my_permissions,
    expiresAt: dto.expires_at ?? undefined,
    edition: dto.edition === "enterprise" || dto.edition === "frozen" ? dto.edition : "community",
    licence: dto.licence
      ? { seats: dto.licence.seats, used: dto.licence.used, validUntil: dto.licence.valid_until, expiresInDays: dto.licence.expires_in_days }
      : undefined,
    preview: dto.preview
      ? {
          roleId: dto.preview.role_id,
          roleName: dto.preview.role_name,
          ...(dto.preview.idle_seconds !== undefined ? { idleSeconds: dto.preview.idle_seconds } : {}),
        }
      : undefined,
  };
}

/** A level from the wire; anything unknown reads as `default`, which is the quiet answer. */
export function toNotifyLevel(level: string | undefined): NotifyLevel {
  return level === "all" || level === "mentions" || level === "none" ? level : "default";
}

export function toChannel(dto: ChannelDto): Channel {
  return {
    id: dto.id,
    name: dto.name,
    fav: dto.favorite,
    unread: dto.unread,
    type: (["public", "private", "archived"].includes(dto.type) ? dto.type : "public") as ChannelType,
    topic: dto.topic,
    member: dto.member,
    allowedRoles: dto.allowed_roles,
    notify: toConversationNotify(dto.notify_level, dto.muted),
    memberCount: dto.member_count,
    lastMessage: dto.last_message ? toLastMessage(dto.last_message) : undefined,
    myPermissions: dto.my_permissions,
  };
}

/** A preview line from the wire; a notice the client cannot word keeps its detail only. */
export function toLastMessage(dto: LastMessageDto): LastMessage {
  return {
    excerpt: dto.excerpt,
    mine: dto.mine,
    at: dto.created_at,
    author: dto.author,
    notice: dto.system_event ? true : undefined,
    systemEvent: isSystemEvent(dto.system_event) ? dto.system_event : undefined,
  };
}

/** A conversation's notification setting from the wire, with the defaults for anything unknown. */
export function toConversationNotify(level: string | undefined, muted: boolean | undefined): ConversationNotify {
  return { level: toNotifyLevel(level), muted: muted === true };
}

// --- Space invitations ---

export type InvitationDto = {
  id: string;
  space_id: string;
  email?: string;
  role: string;
  invited_by?: string;
  uses: number;
  max_uses?: number;
  expires_at?: string;
  guest_expires_at?: string | null;
  created_at: string;
  usable: boolean;
  status?: string;
};

export type CreatedInvitationDto = InvitationDto & { url: string; emailed: boolean };

export type InvitationPreviewDto = { space_name: string; invited_by?: string; email?: string; role: string };

export function toInvitation(dto: InvitationDto): Invitation {
  return {
    id: dto.id,
    email: dto.email,
    role: dto.role,
    invitedBy: dto.invited_by,
    uses: dto.uses,
    maxUses: dto.max_uses,
    expiresAt: dto.expires_at,
    guestExpiresAt: dto.guest_expires_at ?? undefined,
    createdAt: dto.created_at,
    usable: dto.usable,
    status: toInvitationStatus(dto),
  };
}

/** Statuses the API sends, with a fallback for an API older than the field. */
export function toInvitationStatus(dto: InvitationDto): InvitationStatus {
  switch (dto.status) {
    case "accepted":
    case "revoked":
    case "expired":
    case "active":
      return dto.status;
    default:
      return dto.usable ? "active" : "expired";
  }
}

/**
 * A file to upload: a `Blob` (a `File`, on the web) or, in a native app, a file of the phone named by
 * its URI, which React Native's `FormData` reads from the device itself.
 */
export type UploadPart = Blob | { uri: string; name: string; type: string };

/**
 * The file part, and for a file of the phone its name in a field of its own: React Native writes a
 * part's file name percent-encoded ("Devis%20client.pdf"), and the API reads `name` first.
 */
export function appendPart(form: FormData, part: UploadPart): void {
  if (!(part instanceof Blob)) form.append("name", part.name);
  form.append("file", part as Blob);
}

export function toDirectMessage(dto: DirectMessageDto): DirectMessage {
  // The DM list carries no presence (it is volatile); it is overlaid from `getSpacePresence` and
  // realtime events, keyed by the counterpart's user id. Default to offline until that arrives.
  return {
    id: dto.id,
    name: dto.name,
    presence: "offline",
    unread: dto.unread,
    userId: dto.user_id ?? undefined,
    participantIds: dto.participant_ids,
    notify: toConversationNotify(dto.notify_level, dto.muted),
    hidden: dto.hidden === true,
    lastMessage: dto.last_message ? toLastMessage(dto.last_message) : undefined,
  };
}

/**
 * The chat's `MemberDto` (`user_id`, `display_name`, `role`). The rest is what the monolith gave
 * and no product gives now: absent, the screens fall back to the name.
 */
export type MemberDto = {
  user_id: string;
  display_name: string;
  title?: string;
  role: string;
  is_bot?: boolean;
  avatar_url?: string;
  role_ids?: string[];
  group_ids?: string[] | null;
  manageable?: boolean;
  joined_at?: string;
  expires_at?: string | null;
  standing?: string | null;
  imported_from?: string | null;
};

/** A guest whose access ended and whose row is still kept, as the API lists it. */
export type EndedDto = { user_id: string; display_name: string; title?: string | null; ended_at: string; days_left_to_keep: number };

export function toMember(m: MemberDto): Member {
  return {
    userId: m.user_id,
    name: m.display_name,
    role: m.role,
    title: m.title ?? undefined,
    bot: m.is_bot === true,
    avatarUrl: m.avatar_url,
    roleIds: m.role_ids,
    groupIds: m.group_ids ?? undefined,
    manageable: m.manageable,
    joinedAt: m.joined_at,
    expiresAt: m.expires_at ?? undefined,
    standing: m.standing ?? undefined,
    importedFrom: m.imported_from ?? undefined,
  };
}

/** A space member as the app holds it. Presence is overlaid separately (by user id). */
export type Member = {
  userId: string;
  name: string;
  role: string;
  title?: string;
  bot: boolean;
  /** Same-origin URL of the uploaded avatar; absent means the locally generated one. */
  avatarUrl?: string;
  /** The roles assigned to them (Administrator included, base roles never), strongest first. */
  roleIds?: string[];
  /** The groups they are in, from the space's member list. */
  groupIds?: string[];
  /** Whether the caller may manage them (their roles, their removal). */
  manageable?: boolean;
  /** When they joined the space (ISO 8601), from the space's member list. */
  joinedAt?: string;
  /** When a guest's access ends (RFC 3339); absent for no end, and for whoever may not see it. */
  expiresAt?: string;
  /** `owner`, `member` or `guest`, for whoever may manage people and for the person themself. */
  standing?: string;
  /** The import that brought them (`<source>:<job id>`), only in the space member list for whoever manages people. */
  importedFrom?: string;
};

/** A guest whose access ended and who is still kept (90 days), until they are removed for good. */
export type EndedAccess = {
  userId: string;
  name: string;
  title?: string;
  /** When the access ended (RFC 3339). */
  endedAt: string;
  /** Whole days left before they are removed for good. */
  daysLeftToKeep: number;
};

// --- Messages ---

/**
 * A message as this seam returns it: the front {@link Message} shape but with the real string id.
 * The UI's `Message.id` is still numeric (the mock seam); the AppRoot wiring slice flips it to
 * `string`, at which point `ApiMessage` and `Message` coincide and this alias can be dropped. Keeping
 * it as an `Omit`-based alias means it tracks every other change to `Message` in the meantime.
 */
export type ApiMessage = Omit<Message, "id"> & { id: string };

/** A page of a conversation's feed, oldest-last, with a cursor for the previous (older) page. */
export type MessagePage = { messages: ApiMessage[]; nextBefore?: string };

/** What changed in a space since a cursor: see `getChanges`. */
export type SpaceChanges = {
  /** The next cursor. */
  now: string;
  /** Changed messages with the conversation each belongs to, oldest first. */
  changes: { conversationId: string; message: ApiMessage }[];
  /** Too much, or too long ago: reload the space rather than apply a list. */
  truncated: boolean;
};

/** A bookmarked message with where it was said, since it often sits in a space not loaded here. */
export type SavedMessage = {
  message: ApiMessage;
  /** The conversation it was said in. The front `Message` does not carry it, and the label needs it. */
  conversationId: string;
  spaceId: string;
  spaceName: string;
  /** The channel's name; absent for a direct message, which is how the two are told apart. */
  channelName?: string;
};

// --- Mapping helpers ---

export function toReaction(dto: ReactionDto): Reaction {
  return { emoji: dto.emoji, count: dto.count, mine: dto.mine || undefined, users: dto.users };
}

/** Map an API import-source string (free text, e.g. "slack") to the front's capitalized enum. */
export function toImportSource(source?: string): ImportSource | undefined {
  if (!source) return undefined;
  const known: Record<string, ImportSource> = {
    nextcloud: "Nextcloud",
    slack: "Slack",
    mattermost: "Mattermost",
    teams: "Teams",
    ruchoir: "Ruchoir",
  };
  return known[source.toLowerCase()];
}

/** Map the API presence vocabulary (`active|away|dnd|offline`) to the DS presence dot. */
export function toPresence(presence: string): Presence {
  switch (presence) {
    case "active":
      return "online";
    case "dnd":
      return "busy";
    case "away":
      return "away";
    default:
      return "offline";
  }
}

/** Pick a DS icon name for a system message from its event discriminator. */
export function iconForSystemEvent(event?: string): string {
  switch (event) {
    case "member_joined":
    case "channel_joined":
      return "user-plus";
    case "member_left":
    case "member_removed":
    case "channel_left":
    case "channel_removed":
      return "user-minus";
    case "channel_renamed":
    case "channel_topic_changed":
    case "channel_topic_cleared":
      return "square-pen";
    case "channel_made_private":
    case "channel_access_changed":
      return "lock";
    case "channel_made_public":
      return "hash";
    case "channel_archived":
    case "channel_unarchived":
      return "archive";
    case "calendar_event_posted":
      return "calendar";
    case "calendar_event_changed":
      return "calendar-clock";
    case "calendar_event_cancelled":
      return "calendar-x";
    default:
      return "info";
  }
}

export const SYSTEM_EVENTS: SystemEvent[] = [
  "member_joined",
  "member_left",
  "member_removed",
  "channel_joined",
  "channel_left",
  "channel_removed",
  "channel_created",
  "channel_renamed",
  "channel_topic_changed",
  "channel_topic_cleared",
  "channel_made_private",
  "channel_made_public",
  "channel_archived",
  "channel_unarchived",
  "channel_access_changed",
  "calendar_event_posted",
  "calendar_event_changed",
  "calendar_event_cancelled",
];

/** Whether the API reported an event this client knows a sentence for. */
export function isSystemEvent(value: string | undefined): value is SystemEvent {
  return !!value && (SYSTEM_EVENTS as string[]).includes(value);
}

/** Map an attachment kind to the DS file icon the UI expects. */
export function attachmentIcon(kind: string): string {
  switch (kind) {
    case "file-text":
    case "file-spreadsheet":
    case "folder":
      return kind;
    default:
      return "file";
  }
}


// --- Notifications ---

export type NotificationDto = {
  id: string;
  kind: string;
  /** Absent for a calendar reminder. */
  conversation_id?: string;
  /** Absent for a reminder from a personal calendar. */
  space_id?: string;
  /** The channel's name; absent for a direct message. */
  channel_name?: string;
  space_name: string;
  message_id?: string;
  event_id?: string;
  recurrence_id?: string;
  event_title?: string;
  event_start?: string;
  event_all_day?: boolean;
  event_location?: string;
  calendar_name?: string;
  event_changes?: string[];
  event_my_status?: "needs_action" | "accepted" | "tentative" | "declined";
  /** The emoji of a `reaction`. */
  emoji?: string;
  actor_id?: string;
  actor_name?: string;
  /** For the guest notices: when the access ends, and how many days were left when it was written. */
  ends_at?: string | null;
  days_left?: number | null;
  /** For `guest_expiry_soon`: the guest's profile title. */
  guest_title?: string | null;
  /** For `guest_access_ending`: who to ask to extend the access. */
  contact_name?: string | null;
  preview: string;
  created_at: string;
  read: boolean;
};

export type NotificationPageDto = {
  notifications: NotificationDto[];
  next_before?: string;
  unread_count: number;
};

/**
 * A notification as this seam returns it.
 *
 * `channelName` and `spaceName` come from the server because a notification routinely arrives from
 * a space the client has not loaded, where it can name nothing on its own: the caller used to fall
 * back to the conversation's identifier, so a notification from anywhere but the space on screen
 * read as a UUID.
 */
/** What a calendar reminder is about: an occurrence of an event. */
export type ReminderInfo = {
  eventId: string;
  recurrenceId?: string;
  title: string;
  /** RFC 3339 in UTC, or `YYYY-MM-DD` for an all-day event. */
  start: string;
  allDay: boolean;
  location?: string;
  calendarName?: string;
  /** For a change: what changed (`time`, `location`). */
  changes?: string[];
  /** For an invitation kind: the reader's answer as it stands. */
  myStatus?: "needs_action" | "accepted" | "tentative" | "declined";
};

export type ApiNotification = {
  id: string;
  kind: "mention" | "broadcast" | "reply" | "dm" | "message" | "reaction" | "edited" | "calendar_reminder" | "calendar_invitation" | "calendar_update" | "calendar_cancel" | "calendar_declined" | "calendar_shared" | "guest_expiry_soon" | "guest_access_ending";
  conversationId: string;
  /** The space it happened in, so the inbox can be shown for the space on screen. */
  spaceId: string;
  /** The channel's name as the server knows it; absent for a direct message. */
  channelName?: string;
  /** The space's name, so a notification can say where it happened. */
  spaceName: string;
  messageId: string;
  actor: string;
  preview: string;
  /** When the triggering message was sent, RFC 3339. */
  createdAt: string;
  read: boolean;
  /** Set for a calendar reminder or an invitation kind, whose conversation, message and (for a
   *  personal calendar) space are empty strings. */
  reminder?: ReminderInfo;
  /** For a calendar shared with the reader: its name. */
  calendarName?: string;
  /** For a `reaction` to one of the reader's messages: the emoji. */
  emoji?: string;
  /** For a guest notice: when the access ends (RFC 3339), and the days that were left (7 or 1). */
  endsAt?: string;
  daysLeft?: number;
  /** For `guest_expiry_soon`: the guest's profile title. For `guest_access_ending`: who to ask. */
  guestTitle?: string;
  contactName?: string;
  /** For `guest_expiry_soon`: the guest it is about (their user id). */
  actorId?: string;
};

/**
 * Notifications read on one of the person's devices (`notification.read`): these `ids`, or every one
 * when `all` is set, with what is left unread (absent from a server that did not say).
 */
export type NotificationsRead = { ids: string[]; all: boolean; unreadCount?: number };

/** A page of the notification inbox, newest first, with the caller's total unread count. */
export type NotificationFeed = { notifications: ApiNotification[]; nextBefore?: string; unreadCount: number };

export function toApiNotification(dto: NotificationDto): ApiNotification {
  // `broadcast` belongs here: left out, an `@canal` arrived as an ordinary mention and the
  // preference that turns those off could never have been obeyed.
  const kind =
    dto.kind === "mention" ||
    dto.kind === "broadcast" ||
    dto.kind === "reply" ||
    dto.kind === "dm" ||
    dto.kind === "message" ||
    dto.kind === "reaction" ||
    dto.kind === "edited" ||
    dto.kind === "guest_expiry_soon" ||
    dto.kind === "guest_access_ending" ||
    dto.kind.startsWith("calendar_")
      ? (dto.kind as ApiNotification["kind"])
      : "mention";
  return {
    id: dto.id,
    kind,
    conversationId: dto.conversation_id ?? "",
    spaceId: dto.space_id ?? "",
    channelName: dto.channel_name,
    spaceName: dto.space_name,
    messageId: dto.message_id ?? "",
    ...(dto.kind.startsWith("calendar_") && (dto.event_id || dto.event_title)
      ? {
          reminder: {
            // Empty for a cancellation that outlived its event.
            eventId: dto.event_id ?? "",
            recurrenceId: dto.recurrence_id,
            title: dto.event_title ?? "",
            start: dto.event_start ?? dto.created_at,
            allDay: dto.event_all_day === true,
            location: dto.event_location,
            calendarName: dto.calendar_name,
            changes: dto.event_changes,
            myStatus: dto.event_my_status,
          },
        }
      : {}),
    ...(dto.kind === "calendar_shared" && dto.calendar_name ? { calendarName: dto.calendar_name } : {}),
    ...(dto.kind === "reaction" && dto.emoji ? { emoji: dto.emoji } : {}),
    ...(dto.kind.startsWith("guest_") ? { endsAt: dto.ends_at ?? undefined, daysLeft: dto.days_left ?? undefined, actorId: dto.actor_id, guestTitle: dto.guest_title ?? undefined, contactName: dto.contact_name ?? undefined } : {}),
    actor: dto.actor_name ?? "",
    preview: dto.preview,
    createdAt: dto.created_at,
    read: dto.read,
  };
}

/** One member's read cursor in a conversation. */
export type ReadCursor = { userId: string; lastReadMessageId?: string };

// --- Notification delivery (preferences, Web Push) ---

/**
 * The signed-in user's notification settings, as the server keeps them.
 *
 * Held server-side because the server acts on them: a push to a closed browser and the unread
 * digest by email both have to obey a muted channel or quiet hours set on another device.
 */
export type NotificationPreferences = {
  enabled: boolean;
  sound: boolean;
  /** Which kinds reach the person in the app and by push. */
  mentions: boolean;
  channelMentions: boolean;
  replies: boolean;
  directMessages: boolean;
  /** Someone reacted to my message; a message I was told about was edited. Never by mail. */
  reactions: boolean;
  edits: boolean;
  messages: boolean;
  quietHours: boolean;
  quietFrom: string;
  quietTo: string;
  /** Offset of this device's clock from UTC, in minutes: how the server reads the quiet hours. */
  utcOffsetMinutes: number;
  /** Email what is still unread after a while, when no Ruchoir page is open, and which kinds. */
  email: boolean;
  emailMentions: boolean;
  emailBroadcasts: boolean;
  emailReplies: boolean;
  emailDirectMessages: boolean;
  emailMessages: boolean;
  /** Calendar reminders, in the app and by push, and by mail. */
  calendarReminders: boolean;
  emailCalendarReminders: boolean;
  /** Calendar invitations and what follows them, in the app and by push, and by mail. */
  calendarInvitations: boolean;
  emailCalendarInvitations: boolean;
};

/** The hub's categories of notification (`Categories`): each is on unless turned off. */
type CategoriesDto = Partial<Record<"activity" | "direct" | "invitation" | "mention" | "notice" | "reminder" | "reply", boolean>>;

/** The hub's `NotificationPrefs`. */
export type NotificationPrefsDto = {
  enabled?: boolean;
  sound?: boolean;
  /** What reaches the person in the app and by push. */
  app?: CategoriesDto;
  email?: boolean;
  email_categories?: CategoriesDto;
  quiet_hours?: boolean;
  quiet_from?: string;
  quiet_to?: string;
  utc_offset_minutes?: number;
};

/**
 * The screen's switches from the hub's categories. The hub has one category where the screen had
 * two switches (`mention` for personal and channel-wide mentions, `activity` for reactions and
 * edits): both switches show the category, and the first of the pair sets it.
 */
export function fromNotificationPrefs(dto: NotificationPrefsDto): NotificationPreferences {
  const app = dto.app ?? {};
  const mail = dto.email_categories ?? {};
  const on = (value: boolean | undefined) => value !== false;
  return {
    enabled: on(dto.enabled),
    sound: on(dto.sound),
    mentions: on(app.mention),
    channelMentions: on(app.mention),
    replies: on(app.reply),
    directMessages: on(app.direct),
    reactions: on(app.activity),
    edits: on(app.activity),
    messages: on(app.notice),
    quietHours: dto.quiet_hours === true,
    quietFrom: dto.quiet_from ?? "22:00",
    quietTo: dto.quiet_to ?? "08:00",
    utcOffsetMinutes: dto.utc_offset_minutes ?? 0,
    email: on(dto.email),
    emailMentions: on(mail.mention),
    emailBroadcasts: on(mail.mention),
    emailReplies: on(mail.reply),
    emailDirectMessages: on(mail.direct),
    emailMessages: on(mail.notice),
    calendarReminders: on(app.reminder),
    emailCalendarReminders: on(mail.reminder),
    calendarInvitations: on(app.invitation),
    emailCalendarInvitations: on(mail.invitation),
  };
}

/** The hub's `NotificationPrefs` from the screen's switches (see `fromNotificationPrefs`). */
export function toNotificationPrefs(prefs: NotificationPreferences): NotificationPrefsDto {
  return {
    enabled: prefs.enabled,
    sound: prefs.sound,
    app: {
      mention: prefs.mentions,
      reply: prefs.replies,
      direct: prefs.directMessages,
      activity: prefs.reactions,
      notice: prefs.messages,
      reminder: prefs.calendarReminders,
      invitation: prefs.calendarInvitations,
    },
    email: prefs.email,
    email_categories: {
      mention: prefs.emailMentions,
      reply: prefs.emailReplies,
      direct: prefs.emailDirectMessages,
      notice: prefs.emailMessages,
      reminder: prefs.emailCalendarReminders,
      invitation: prefs.emailCalendarInvitations,
      // Reactions and edits never go by mail.
      activity: false,
    },
    quiet_hours: prefs.quietHours,
    quiet_from: prefs.quietFrom,
    quiet_to: prefs.quietTo,
    utc_offset_minutes: prefs.utcOffsetMinutes,
  };
}

/** Whether the instance sends Web Push, and the key a browser subscribes against. */
export type PushConfig = { available: boolean; publicKey?: string };

// --- Search ---

export type FileHitDto = { id: string; name: string; kind: string };
export type SearchResultsDto = { messages: MessageDto[]; files: FileHitDto[] };

/** A file matched by search: enough to render a result row and open it. */
export type FileHit = { id: string; name: string; kind: string };
/** A message matched by search, carrying its conversation id so a click can navigate to it. */
export type SearchMessage = ApiMessage & { conversationId: string };
/** Combined search results: matching messages and file names the caller can see. */
export type SearchHits = { messages: SearchMessage[]; files: FileHit[] };

// --- Files ---

export type FileDto = {
  id: string;
  organisation_id: string;
  name: string;
  kind: string;
  is_folder: boolean;
  parent_folder_id?: string;
  size_bytes: number;
  owner_id?: string;
  owner_name?: string;
  mime_type?: string;
  version_id?: string;
  version_no?: number;
  has_thumbnail: boolean;
  image_width?: number;
  image_height?: number;
  imported: boolean;
  imported_source?: string;
  created_at: string;
  updated_at: string;
  modified_by_id?: string;
  modified_by_name?: string;
  child_count?: number;
  starred?: boolean;
  /** Who is editing it in the office editor, by account id. */
  editors?: string[] | null;
  my_permissions?: string[] | null;
};

export type FolderListingDto = {
  folder_id?: string;
  breadcrumb: { id: string; name: string }[];
  entries: FileDto[];
};

/** A resolved folder view: its id (absent at root), breadcrumb trail and entries as UI files. */
export type FolderListing = {
  folderId?: string;
  breadcrumb: { id: string; name: string }[];
  entries: SpaceFile[];
};

export function toSpaceFileKind(kind: string, isFolder: boolean): SpaceFile["kind"] {
  if (isFolder || kind === "folder") return "folder";
  if (kind === "file-text" || kind === "file-spreadsheet" || kind === "image") return kind;
  return "file";
}

/**
 * A space keeps no duplicate (the server checks its whole tree): an upload of a name already in the
 * folder is refused (`same_file` when the bytes are the same too, `same_name` otherwise) until it is
 * sent again with an answer, and the same bytes elsewhere become the next version of the file that
 * holds them (`merged` on the answer), or are refused (`same_content`) to someone who may not
 * change that file.
 */
export type UploadDuplicate = {
  reason: "same_file" | "same_name" | "same_content";
  existing: SpaceFile;
  /** The folders the existing file is in, from the space's root. */
  path: string[];
};

/** Sent again after a duplicate: a new version of the file there, or a copy under a numbered name. */
export type DuplicateAnswer = "replace" | "keep_both";

/** An uploaded file; `merged` when the bytes became the next version of a file already there. */
export type UploadedFile = SpaceFile & { merged?: boolean };

// --- Trash and versions ---

export type TrashEntryDto = {
  file: FileDto;
  deleted_at: string;
  deleted_by_id?: string;
  deleted_by_name?: string;
  original_folder_id?: string;
  original_folder_name?: string;
  original_folder_present: boolean;
  can_manage: boolean;
};

/** One entry of a space's trash: what was removed, when, by whom, and from where. */
export type TrashEntry = {
  file: SpaceFile;
  deletedAt: string;
  deletedBy?: string;
  /** The folder it was in (absent: the space root), and whether it is still there. */
  originalFolderId?: string;
  originalFolderName?: string;
  originalFolderPresent: boolean;
  /** Whether this person may restore it or erase it. */
  canManage: boolean;
};

export type VersionDto = {
  id: string;
  version_no: number;
  size_bytes: number;
  mime_type: string;
  created_at: string;
  created_by_id?: string;
  created_by_name?: string;
  current: boolean;
};

/** One version of a file. */
export type FileVersion = {
  id: string;
  number: number;
  sizeBytes: number;
  createdAt: string;
  createdBy?: string;
  /** The version the file serves now. */
  current: boolean;
};

// --- Views beyond a folder ---

export type ViewEntryDto = {
  file: FileDto;
  path: { id: string; name: string }[];
  shared_by_name?: string;
  shared_in_kind?: "channel" | "dm";
  shared_in_name?: string;
  shared_at?: string;
};

/** One entry of a view (recent, favourites, shared with me, search): the file and where it lives. */
export type ViewEntry = {
  file: SpaceFile;
  /** Its folders from the space root down (empty at the root). */
  path: { id: string; name: string }[];
  sharedBy?: string;
  sharedIn?: { kind: "channel" | "dm"; name?: string };
  sharedAt?: string;
};

export type FilesView = "recent" | "starred" | "shared";

// --- Public links ---

export type LinkDto = {
  id: string;
  token: string;
  created_at: string;
  created_by_name?: string;
  expires_at?: string;
  expired: boolean;
  has_password: boolean;
  download_count: number;
};

/** A file's public link, as those who manage the file see it. */
export type FileLink = {
  id: string;
  token: string;
  /** The address to hand out. */
  url: string;
  createdAt: string;
  createdBy?: string;
  expiresAt?: string;
  expired: boolean;
  hasPassword: boolean;
  downloads: number;
};

export type PublicLinkDto = {
  needs_password: boolean;
  name?: string;
  size_bytes?: number;
  mime_type?: string;
  shared_by?: string;
  expires_at?: string;
  has_thumbnail?: boolean;
  preview?: PublicPreview;
};

/** How a shared file's page can show it. */
export type PublicPreview = "image" | "pdf" | "document" | "video" | "audio" | "text";

/** What a public link shows: only that it asks for a password, until it has been given. */
export type PublicLink =
  | { needsPassword: true }
  | {
      needsPassword: false;
      name: string;
      sizeBytes: number;
      mimeType?: string;
      sharedBy?: string;
      expiresAt?: string;
      hasThumbnail: boolean;
      preview?: PublicPreview;
    };

export function toPublicLink(dto: PublicLinkDto): PublicLink {
  if (dto.needs_password) return { needsPassword: true };
  return {
    needsPassword: false,
    name: dto.name ?? "",
    sizeBytes: dto.size_bytes ?? 0,
    mimeType: dto.mime_type,
    sharedBy: dto.shared_by,
    expiresAt: dto.expires_at,
    hasThumbnail: dto.has_thumbnail === true,
    preview: dto.preview,
  };
}

/** A sending in flight: its result, and the way to stop it. */
export type UploadRequest<T = SpaceFile> = { done: Promise<T>; abort: () => void };

// --- Live office editing ---

export type OfficeSessionDto = {
  file: FileDto;
  url: string;
  access_token: string;
  access_token_ttl: number;
  mode: OfficeMode;
  config: string;
  member_name?: string;
};

/** What the editor can do with a file of this name on this instance. */
export function officeActionFor(
  name: string,
  caps: OfficeCapabilities | null,
): "edit" | "convert" | "view" | null {
  if (!caps?.enabled) return null;
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
  if (!ext) return null;
  if (caps.edit.includes(ext)) return "edit";
  if (caps.convert.includes(ext)) return "convert";
  if (caps.view.includes(ext)) return "view";
  return null;
}

// --- Realtime (WebSocket) ---

/**
 * A frame of the hub's live socket: a product's `ClientFrame` (`ruchoir-events`). `type` is named
 * after its product (`chat.message.created`), `scope` is what it is about (a conversation), and the
 * shape of `payload` depends on `type` (`../hub/live.ts`).
 */
export type RealtimeEnvelope = { v: number; type: string; scope?: string; payload: unknown };

/** What `hub.inbox.new` says: something reached the inbox, read it again for the entry itself. */
export type InboxArrival = { kind: string; category: string; organisationId?: string };

/** A reaction delta carried by a `reaction.added` / `reaction.removed` event. */
export type RealtimeReaction = { messageId: string; emoji: string; userId: string; added: boolean };

/**
 * A channel's shared facts as pushed by `channel.created` / `channel.updated`. It carries no
 * per-caller state (favourite, membership, unread): the receiving client keeps its own.
 */
export type RealtimeChannel = {
  id: string;
  spaceId: string;
  name: string;
  type: ChannelType;
  topic?: string;
};

/**
 * Someone who just joined a space, pushed live. Same shape as a {@link Member} plus the space it
 * happened in, so the app can ignore an arrival in a space it does not currently hold.
 */
export type RealtimeMember = Member & { spaceId: string };

/**
 * A member's identity after a profile change, pushed live. No space: a profile is the same in every
 * one of them, and no role either, since a profile edit cannot change it.
 */
export type MemberIdentity = Omit<Member, "role">;

/**
 * A space's shared identity after a change, pushed live. Carries no counters and no role: those are
 * per-caller and are never broadcast, so a recipient keeps the ones it already holds.
 */
export type SpaceIdentity = { id: string; name: string; slug: string; iconUrl?: string; defaultChannelId?: string };

/**
 * Someone's place in a channel changed, pushed live to them on every device, and for a role to the
 * channel's members: the channel's notice already tells the others of an arrival or a departure.
 */
export type ChannelMembership = {
  spaceId: string;
  channelId: string;
  userId: string;
  change: "joined" | "left" | "removed" | "role";
  /** The new role, for a `role` change. */
  role?: string;
};

/** Handlers the app wires to live events. All optional; unhandled event types are ignored. */
export type RealtimeHandlers = {
  /**
   * The connection came back after being lost. Whatever was pushed in between is gone for good (the
   * transport does not replay), so the caller re-reads what it has on screen.
   */
  onReconnect?: () => void;
  onMessageCreated?: (conversationId: string, message: ApiMessage) => void;
  onMessageUpdated?: (conversationId: string, message: ApiMessage) => void;
  onMessageDeleted?: (conversationId: string, message: ApiMessage) => void;
  onReaction?: (conversationId: string, reaction: RealtimeReaction) => void;
  onPinned?: (conversationId: string, messageId: string, pinned: boolean) => void;
  /** A channel was created in a space the user belongs to. */
  onChannelCreated?: (channel: RealtimeChannel) => void;
  /** A channel was renamed, re-topiced, archived, restored, or changed visibility. */
  onChannelUpdated?: (channel: RealtimeChannel) => void;
  /** Someone joined a space the user belongs to. */
  onMemberJoined?: (member: RealtimeMember) => void;
  /** Someone left a space the user belongs to: the roster on screen has to lose them. */
  onMemberLeft?: (spaceId: string, userId: string) => void;
  /**
   * A member's role in a space changed. Also fires for the recipient's own membership, which is how
   * a space they have just been handed (or stepped down from) gains or loses its controls.
   */
  onMemberRoleChanged?: (spaceId: string, userId: string, role: string) => void;
  /** Someone the user shares a space with changed their display name, title or avatar. */
  onMemberUpdated?: (member: MemberIdentity) => void;
  /** A space the user belongs to was renamed, or had its icon replaced or removed. */
  onSpaceUpdated?: (space: SpaceIdentity) => void;
  /** A space's administrators put its channels in a new order: re-read that space's list. */
  onChannelsReordered?: (spaceId: string) => void;
  /**
   * What someone may do in a space changed (a role, a standing, a rule): ask again for what the
   * signed-in user may do there (`myPermissions`). Carries nobody's rights.
   */
  onPermissionsChanged?: (spaceId: string) => void;
  /** Someone joined, left or was removed from a channel, or their role there changed. */
  onChannelMembership?: (change: ChannelMembership) => void;
  /**
   * A space stopped being the user's. The reason is what the sentence is drawn from: `left` (from
   * here or another tab, so they already know), `deleted` (its owner ended it), `removed` (somebody
   * took them out of it, which they have to be told or a space vanishes from under them).
   */
  onSpaceRemoved?: (spaceId: string, reason: "left" | "deleted" | "removed") => void;
  /**
   * Some of the person's account preferences changed, on this device or another one: the keys and
   * their new values, `null` for one back to its default.
   */
  onPreferencesUpdated?: (changes: AccountPrefsDoc) => void;
  /** The person hid one of their direct conversations, or brought it back, here or elsewhere. */
  onDmHidden?: (dmId: string, hidden: boolean) => void;
  /** A channel was deleted, with its history: it leaves the sidebar and the open conversation. */
  onChannelDeleted?: (spaceId: string, channelId: string) => void;
  onPresence?: (userId: string, presence: Presence) => void;
  /** Something reached the person's inbox (`hub.inbox.new`): the entry is read from the inbox. */
  onNotification?: (arrival: InboxArrival) => void;
  /** Some of the person's notifications were read, on this device or another one. */
  onNotificationsRead?: (read: NotificationsRead) => void;
  onTyping?: (conversationId: string, userId: string) => void;
  /** Someone's read cursor moved in a conversation the recipient belongs to. */
  onReadCursor?: (conversationId: string, userId: string, lastReadMessageId: string) => void;
  /** Files were removed from a space: anything showing them has to stop offering them. */
  onFilesDeleted?: (spaceId: string, fileIds: string[]) => void;
  /** A file gained a version, or the server created one (a blank document, a converted copy). */
  onFilesUpdated?: (spaceId: string, folderId?: string) => void;
  /** Who is editing a file in the office editor changed. */
  onFilesEditing?: (spaceId: string, fileId: string, editors: FileEditor[]) => void;
  /** A calendar, its settings or its events changed: whatever shows it reloads. */
  onCalendarChanged?: (calendarId: string) => void;
};

/** A live realtime connection: close it on teardown, and signal typing over it. */
export type RealtimeConnection = { close: () => void; sendTyping: (conversationId: string) => void };

// --- Bringing a workspace over from another product ----------------------------------------------
//
// Only an instance administrator sees any of this: every route below answers 404 to everyone else,
// so a client that shows the screen to the wrong person shows them a screen full of errors.

/** One licensed space's seats around an import, before the run. */
export type SeatsLine = { space: string; used: number; incoming: number; total: number; over: boolean };

/** A role of the source this server cannot create, and the fixed role the people get instead. */
export type PlannedFallback = { role: string; fixed: "member" | "admin"; people: number };

/** What the archive says about roles, guests and groups, from the plan. */
export type PeoplePlan = {
  administrators: number;
  guests: number;
  moderators: number;
  /** How many groups would be created. */
  groups: number;
  /** The first of their names. */
  groupNames: string[];
  customRoles: number;
  fallbacks: PlannedFallback[];
  /** The first names of people already in their space, whose role is left alone. */
  alreadyHere: string[];
  alreadyHereTotal: number;
  /** One line per filled, licensed space: empty for a created space or a community one. */
  seats: SeatsLine[];
};

/** A role of the source that went to a fixed role, in one space, once the run is over. */
export type FallbackSummary = { space: string; roleName: string; fixed: "member" | "admin"; people: number };

/** A licensed space's seats around a finished run. */
export type SeatsSummary = { space: string; usedBefore: number; added: number; total: number };

/** What crossed in terms of people, groups and roles, as the job reports it. */
export type PeopleSummary = {
  administrators: number;
  guests: number;
  moderators: number;
  groups: number;
  groupNames: string[];
  kept: number;
  keptNames: string[];
  customRoles: number;
  fallbacks: FallbackSummary[];
  seats: SeatsSummary[];
  /** The names of the spaces the job created (the others were filled). */
  createdSpaces: string[];
};

/** What an import would do, from `POST /imports/plan`. Nothing is written to produce it. */
export type ImportPlan = {
  source: string;
  spaces: {
    name: string;
    outcome: "created" | "filled";
    channels: number;
    /** Channels of this space that are already here: they take the history rather than be created. */
    channelsFilled: number;
    directs: number;
  }[];
  accounts: {
    total: number;
    matched: number;
    invitable: number;
    withoutAddress: number;
    people: { sourceId: string; displayName: string; email: string; outcome: string }[];
  };
  messages: number;
  files: number;
  /** Calendars (each a personal calendar of its owner) and the events they hold. */
  calendars: number;
  events: number;
  /** The producer's own words about what it left behind. Shown in full, never summarised. */
  limits: string[];
  warnings: string[];
  /** Who arrives with which role, and what it costs in seats. */
  people: PeoplePlan;
  /** What replacing the instance would destroy, so both halves of the choice are visible at once. */
  replacingWouldDestroy: {
    spaces: number;
    accounts: number;
    messages: number;
    spaceNames: string[];
    lastBackup: string | null;
    replacementAllowed: boolean;
  };
};

/** An import, running or finished, from `GET /imports`. */
export type ImportJob = {
  id: string;
  source: string;
  status: "pending" | "analyzing" | "ready" | "running" | "cancelling" | "cancelled" | "completed" | "failed";
  accountsDone: number;
  accountsTotal: number;
  channelsDone: number;
  channelsTotal: number;
  messagesDone: number;
  messagesTotal: number;
  filesDone: number;
  filesTotal: number;
  calendarsDone: number;
  calendarsTotal: number;
  eventsDone: number;
  eventsTotal: number;
  error: string | null;
  /** When it ended, RFC 3339, or null while it runs. */
  finishedAt: string | null;
  /** What crossed in people, groups and roles; null while it runs and for an import from before this was kept. */
  people: PeopleSummary | null;
  /** The producer's own words about what it left behind, kept for the done screen. */
  limits: string[];
  /** Who started it; null once their account is gone. */
  startedBy: { id: string; name: string } | null;
};

export type ImportJobDto = {
  id: string;
  source: string;
  status: ImportJob["status"];
  accounts_done: number;
  accounts_total: number;
  channels_done: number;
  channels_total: number;
  messages_done: number;
  messages_total: number;
  files_done: number;
  files_total: number;
  calendars_done?: number;
  calendars_total?: number;
  events_done?: number;
  events_total?: number;
  error: string | null;
  finished_at: string | null;
  people?: PeopleSummaryDto | null;
  limits?: string[];
  started_by?: { id: string; name: string } | null;
};

export type PeopleSummaryDto = {
  administrators: number;
  guests: number;
  moderators: number;
  groups: number;
  group_names?: string[];
  kept: number;
  kept_names?: string[];
  custom_roles: number;
  fallbacks?: { space: string; role_name: string; fixed: string; people: number }[];
  seats?: { space: string; used_before: number; added: number; total: number }[];
  created_spaces?: string[];
};

export const fixedRole = (v: string): "member" | "admin" => (v === "admin" ? "admin" : "member");

export function toPeopleSummary(dto: PeopleSummaryDto): PeopleSummary {
  return {
    administrators: dto.administrators,
    guests: dto.guests,
    moderators: dto.moderators,
    groups: dto.groups,
    groupNames: dto.group_names ?? [],
    kept: dto.kept,
    keptNames: dto.kept_names ?? [],
    customRoles: dto.custom_roles,
    fallbacks: (dto.fallbacks ?? []).map((f) => ({ space: f.space, roleName: f.role_name, fixed: fixedRole(f.fixed), people: f.people })),
    seats: (dto.seats ?? []).map((x) => ({ space: x.space, usedBefore: x.used_before, added: x.added, total: x.total })),
    createdSpaces: dto.created_spaces ?? [],
  };
}

export function toImportJob(dto: ImportJobDto): ImportJob {
  return {
    id: dto.id,
    source: dto.source,
    status: dto.status,
    accountsDone: dto.accounts_done,
    accountsTotal: dto.accounts_total,
    channelsDone: dto.channels_done,
    channelsTotal: dto.channels_total,
    messagesDone: dto.messages_done,
    messagesTotal: dto.messages_total,
    filesDone: dto.files_done,
    filesTotal: dto.files_total,
    calendarsDone: dto.calendars_done ?? 0,
    calendarsTotal: dto.calendars_total ?? 0,
    eventsDone: dto.events_done ?? 0,
    eventsTotal: dto.events_total ?? 0,
    error: dto.error,
    finishedAt: dto.finished_at,
    people: dto.people ? toPeopleSummary(dto.people) : null,
    limits: dto.limits ?? [],
    startedBy: dto.started_by ?? null,
  };
}

/**
 * `POST /imports`: start it.
 *
 * `replaceInstanceAddress`, when given, empties the instance first: every space and every account
 * except the one asking. The server checks the address, and refuses without a recent backup.
 */
/** What an administrator changed about one person after reading the plan. */
export type PersonChoice = {
  sourceId: string;
  /** An address given or corrected by hand. Absent means the archive's own. */
  email?: string;
  /** Leave this person out. Their messages still arrive, with no author. */
  skip?: boolean;
};

/** What happened when the invitations went out. */
export type InviteOutcome = {
  sent: number;
  skipped: { sourceId: string; reason: string }[];
};

/** Somebody an import brought over, read back from the server rather than from a plan. */
export type ImportedPerson = {
  sourceId: string;
  displayName: string;
  /** Empty when nobody ever gave them one: they cannot be invited by mail. */
  email: string;
  /** Whether an invitation has already gone to that address. */
  invited: boolean;
};

/** A one-time credential a delivery command carries, with the instance address it delivers to. */
export type DropToken = {
  token: string;
  baseUrl: string;
  expiresInSecs: number;
};

/** An archive sitting in the server's import directory. */
export type ImportFile = {
  name: string;
  bytes: number;
  /** Last modified, RFC 3339, or null when the filesystem would not say. */
  modified: string | null;
};

/**
 * Every call that speaks to an instance, bound to `transport`: its address and its credentials.
 *
 * `createClient` (`client.ts`) builds one set per instance, so two instances never share an address,
 * a token or a socket; the module-level exports below are the default client's, which is all the
 * web ever uses.
 */
