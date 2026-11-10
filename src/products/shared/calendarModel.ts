/**
 * The calendar's side of the API: calendars, occurrences of a period, events and their series, the
 * viewer's own settings, and iCal subscription addresses.
 *
 * Kept apart from `api.ts`, which is long enough already; the shapes follow the API's DTOs
 * (`apps/api/src/calendar/dto.rs`), renamed to the web's camelCase on the way in.
 */


/** The palette's pastels a calendar may wear. */
/** A palette pastel, or `accent`: the viewer's own theme accent (what a personal calendar wears). */
export type CalendarColor = "accent" | "sky" | "mint" | "violet" | "pink" | "peach" | "lime" | "sun";
export const CALENDAR_COLORS: readonly CalendarColor[] = ["accent", "sky", "mint", "violet", "pink", "peach", "lime", "sun"];


export type Calendar = {
  id: string;
  /** Absent for a personal calendar. */
  spaceId?: string;
  name: string;
  description?: string;
  color: CalendarColor;
  writeAccess: "members" | "admins";
  /** The reminders a timed event gets by default, in minutes before it; empty is none. */
  defaultReminders: number[];
  isDefault: boolean;
  canWriteEvents: boolean;
  canManage: boolean;
  hidden: boolean;
  /** The viewer's own reminders for the whole calendar: `undefined` follows the defaults, empty is
   *  none. */
  myReminders?: number[];
  /** Someone else's calendar shared with the viewer: how far, and whose. */
  shareLevel?: ShareLevel;
  ownerName?: string;
};

/** How far a personal calendar is shared: busy blocks, its details, or its events too. */
export type ShareLevel = "freebusy" | "read" | "write";

/** Someone a calendar is shared with. */
export type Share = { userId: string; name: string; level: ShareLevel };

export type Occurrence = {
  eventId: string;
  calendarId: string;
  recurrenceId?: string;
  title: string;
  location?: string;
  /** The occurrence's notes: its own when it was changed apart, else the series'. */
  description?: string;
  allDay: boolean;
  /** RFC 3339 (UTC) for a timed occurrence, `YYYY-MM-DD` for an all-day one. */
  start: string;
  end: string;
  tzid?: string;
  isRecurring: boolean;
  overridden: boolean;
  canEdit: boolean;
  /** The reminders the viewer gets for it, in minutes; empty when none. */
  myReminders: number[];
  /** The viewer's answer for this occurrence; `accepted` for the organiser of an event with
   *  attendees; absent for anyone not on its list. */
  myStatus?: AttendeeStatus;
  /** Seen through an invitation alone: its calendar is not the viewer's to see. */
  invited: boolean;
  hasAttendees: boolean;
  /** A busy block from a calendar shared at the free/busy level: no title, place or notes, and it
   *  does not open. */
  busy: boolean;
};

/** An answer to an invitation. */
export type AttendeeStatus = "needs_action" | "accepted" | "tentative" | "declined";

export type Attendee = {
  id: string;
  userId?: string;
  /** For someone invited by address only. */
  email?: string;
  name: string;
  status: AttendeeStatus;
};

/** Someone on the list as the form sends it: an account, or an address. */
export type AttendeeInput = { userId: string } | { email: string; name?: string };

export type CalendarEvent = Occurrence & {
  rrule?: string;
  createdBy?: string;
  updatedAt: string;
  organizer?: { userId: string; name: string };
  attendees: Attendee[];
  /** The channel it is linked to. */
  channel?: EventChannel;
  /** The Drive files it carries, readable by whoever sees it. */
  files: EventFile[];
  /** The viewer's own reminders: `undefined` follows their calendar's, empty is none. */
  myOwnReminders?: number[];
};

/** The channel an event is linked to, as the viewer may know it: a private channel they are not in
 *  has no name. */
export type EventChannel = { id: string; name?: string; spaceId: string; private: boolean; accessible: boolean };

/** A channel an event may be linked to. */
export type LinkableChannel = { id: string; name: string; spaceId: string; spaceName: string; private: boolean };

/** A Drive file an event carries. */
export type EventFile = { id: string; name: string; size: number };

/** An event as its card in a channel shows it to the reader: its next occurrence. */
export type EventCard = {
  eventId: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  tzid?: string;
  location?: string;
  recurring: boolean;
  organizer?: string;
  organizerId?: string;
  myStatus?: AttendeeStatus;
  recurrenceId?: string;
};

/** An occurrence a channel lists as upcoming. */
export type UpcomingEvent = {
  eventId: string;
  recurrenceId?: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location?: string;
};

/** Someone who may be invited. */
export type Invitee = { userId: string; name: string };

/** One person's busy times, RFC 3339 in UTC, merged. */
export type BusyTimes = { userId: string; busy: { start: string; end: string }[] };

/** An invitation as someone invited by address sees it, on its public page. */
export type PublicInvitation = {
  title: string;
  location?: string;
  description?: string;
  start: string;
  end: string;
  allDay: boolean;
  tzid?: string;
  recurring: boolean;
  organizer?: string;
  name?: string;
  status: AttendeeStatus;
  /** Files to download with the page's token. */
  files: EventFile[];
};

/** What the form sends for a new event or a change. */
export type EventInput = {
  title: string;
  description?: string;
  location?: string;
  allDay: boolean;
  start: string;
  end: string;
  tzid?: string;
  rrule?: string | null;
  /** The author's own reminders: `undefined` leaves them as they are, empty turns them off. */
  reminders?: number[];
  /** Another calendar to move the event to (whole-series changes only). */
  calendarId?: string;
  /** The whole list of attendees; `undefined` leaves it as it is. */
  attendees?: AttendeeInput[];
  /** The linked channel; `null` unlinks it, `undefined` leaves it as it is. */
  channelId?: string | null;
  /** The whole list of attached files; `undefined` leaves it as it is. */
  files?: string[];
};

export type EditScope = "this" | "following" | "all";

export type Feed = { id: string; calendarId?: string; createdAt: string; lastUsedAt?: string };
export type CreatedFeed = { id: string; calendarId?: string; url: string; createdAt: string };

export type CalendarDto = {
  id: string;
  space_id?: string | null;
  name: string;
  description?: string | null;
  color: CalendarColor;
  write_access: "members" | "admins";
  default_reminders: number[];
  is_default: boolean;
  can_write_events: boolean;
  can_manage: boolean;
  hidden: boolean;
  my_reminders?: number[];
  share_level?: ShareLevel;
  owner_name?: string;
};

export type OccurrenceDto = {
  event_id: string;
  calendar_id: string;
  recurrence_id?: string | null;
  title: string;
  location?: string | null;
  description?: string | null;
  all_day: boolean;
  start: string;
  end: string;
  tzid?: string | null;
  is_recurring: boolean;
  overridden: boolean;
  can_edit: boolean;
  my_reminders?: number[];
  my_status?: AttendeeStatus | null;
  invited?: boolean;
  has_attendees?: boolean;
  busy?: boolean;
};

export type AttendeeDto = { id: string; user_id?: string | null; email?: string | null; name: string; status: AttendeeStatus };

export type EventDto = OccurrenceDto & {
  rrule?: string | null;
  created_by?: string | null;
  updated_at: string;
  organizer?: { user_id: string; name: string } | null;
  attendees?: AttendeeDto[];
  channel?: { id: string; name?: string | null; space_id: string; private: boolean; accessible: boolean } | null;
  files?: EventFile[];
  my_own_reminders?: number[];
};

export type EventCardDto = {
  event_id: string;
  title: string;
  start: string;
  end: string;
  all_day: boolean;
  tzid?: string | null;
  location?: string | null;
  recurring: boolean;
  organizer?: string | null;
  organizer_id?: string | null;
  my_status?: AttendeeStatus | null;
  recurrence_id?: string | null;
};

export type FeedDto = { id: string; calendar_id?: string | null; created_at: string; last_used_at?: string | null; url?: string };

export function opt<T>(value: T | null | undefined): T | undefined {
  return value === null ? undefined : value;
}

export function toCalendar(dto: CalendarDto): Calendar {
  return {
    id: dto.id,
    spaceId: opt(dto.space_id),
    name: dto.name,
    description: opt(dto.description),
    color: dto.color,
    writeAccess: dto.write_access,
    defaultReminders: dto.default_reminders ?? [],
    isDefault: dto.is_default,
    canWriteEvents: dto.can_write_events,
    canManage: dto.can_manage,
    hidden: dto.hidden,
    ...(dto.my_reminders !== undefined ? { myReminders: dto.my_reminders } : {}),
    ...(dto.share_level ? { shareLevel: dto.share_level, ownerName: dto.owner_name ?? "" } : {}),
  };
}

export function toOccurrence(dto: OccurrenceDto): Occurrence {
  return {
    eventId: dto.event_id,
    calendarId: dto.calendar_id,
    recurrenceId: opt(dto.recurrence_id),
    title: dto.title,
    location: opt(dto.location),
    description: opt(dto.description),
    allDay: dto.all_day,
    start: dto.start,
    end: dto.end,
    tzid: opt(dto.tzid),
    isRecurring: dto.is_recurring,
    overridden: dto.overridden,
    canEdit: dto.can_edit,
    myReminders: dto.my_reminders ?? [],
    myStatus: opt(dto.my_status),
    invited: dto.invited ?? false,
    hasAttendees: dto.has_attendees ?? false,
    busy: dto.busy ?? false,
  };
}

export function toEvent(dto: EventDto): CalendarEvent {
  return {
    ...toOccurrence(dto),
    rrule: opt(dto.rrule),
    createdBy: opt(dto.created_by),
    updatedAt: dto.updated_at,
    organizer: dto.organizer ? { userId: dto.organizer.user_id, name: dto.organizer.name } : undefined,
    attendees: (dto.attendees ?? []).map((a) => ({
      id: a.id,
      userId: opt(a.user_id),
      email: opt(a.email),
      name: a.name,
      status: a.status,
    })),
    channel: dto.channel
      ? {
          id: dto.channel.id,
          name: opt(dto.channel.name),
          spaceId: dto.channel.space_id,
          private: dto.channel.private,
          accessible: dto.channel.accessible,
        }
      : undefined,
    files: dto.files ?? [],
    ...(dto.my_own_reminders !== undefined ? { myOwnReminders: dto.my_own_reminders } : {}),
  };
}

/** A message's event card, as the API sends it. */
export function toEventCard(dto: EventCardDto): EventCard {
  return {
    eventId: dto.event_id,
    title: dto.title,
    start: dto.start,
    end: dto.end,
    allDay: dto.all_day,
    tzid: opt(dto.tzid),
    location: opt(dto.location),
    recurring: dto.recurring,
    organizer: opt(dto.organizer),
    organizerId: opt(dto.organizer_id),
    myStatus: opt(dto.my_status),
    recurrenceId: opt(dto.recurrence_id),
  };
}

export function toFeed(dto: FeedDto): Feed {
  return { id: dto.id, calendarId: opt(dto.calendar_id), createdAt: dto.created_at, lastUsedAt: opt(dto.last_used_at) };
}

export function eventBody(input: EventInput) {
  return {
    title: input.title,
    description: input.description,
    location: input.location,
    all_day: input.allDay,
    start: input.start,
    end: input.end,
    tzid: input.tzid,
    rrule: input.rrule ?? null,
    ...(input.reminders !== undefined ? { reminders: input.reminders } : {}),
    calendar_id: input.calendarId,
    ...(input.attendees
      ? { attendees: input.attendees.map((a) => ("userId" in a ? { user_id: a.userId } : { email: a.email, name: a.name })) }
      : {}),
    ...(input.channelId !== undefined ? { channel_id: input.channelId } : {}),
    ...(input.files ? { files: input.files } : {}),
  };
}

export type CalendarFields = {
  name: string;
  color: CalendarColor;
  description?: string;
  writeAccess?: "members" | "admins";
  defaultReminders?: number[];
};

export function calendarBody(fields: Partial<CalendarFields>) {
  return {
    name: fields.name,
    color: fields.color,
    description: fields.description,
    write_access: fields.writeAccess,
    ...(fields.defaultReminders !== undefined ? { default_reminders: fields.defaultReminders } : {}),
  };
}

export function scopeQuery(scope: EditScope, recurrenceId?: string): string {
  const params = new URLSearchParams({ scope });
  if (recurrenceId) params.set("recurrence_id", recurrenceId);
  return params.toString();
}

export type PublicInvitationDto = {
  title: string;
  location?: string | null;
  description?: string | null;
  start: string;
  end: string;
  all_day: boolean;
  tzid?: string | null;
  recurring: boolean;
  organizer?: string | null;
  name?: string | null;
  status: AttendeeStatus;
  files?: EventFile[];
};

export function toPublicInvitation(dto: PublicInvitationDto): PublicInvitation {
  return {
    title: dto.title,
    location: opt(dto.location),
    description: opt(dto.description),
    start: dto.start,
    end: dto.end,
    allDay: dto.all_day,
    tzid: opt(dto.tzid),
    recurring: dto.recurring,
    organizer: opt(dto.organizer),
    name: opt(dto.name),
    status: dto.status,
    files: dto.files ?? [],
  };
}

/** The calendar calls, bound to `transport` (see `createApi` in `api.ts`). */
