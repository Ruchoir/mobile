/**
 * The calendar's API (`contract/openapi-v1.json` of Ruchoir/calendar): calendars, occurrences,
 * events, answers, reminders and free-busy.
 *
 * Each call is the route of the product, made with its own access token (`../http`).
 */
import type { Transport } from "../shared/http.ts";
import { calendarBody, eventBody, opt, scopeQuery, toCalendar, toEvent, toFeed, toOccurrence, toPublicInvitation } from "../shared/calendarModel.ts";
import type { AttendeeStatus, BusyTimes, Calendar, CalendarDto, CalendarEvent, CalendarFields, CreatedFeed, EditScope, EventDto, EventInput, Feed, FeedDto, Occurrence, OccurrenceDto, PublicInvitation, PublicInvitationDto, Share, ShareLevel, UpcomingEvent } from "../shared/calendarModel.ts";

export function createCalendarApi(transport: Transport) {
  const { apiRequest, apiGet, apiPost, apiPut, apiPatch, apiDelete, apiBase } = transport;

  /** `GET /calendars`: every calendar the viewer sees, theirs first. */
  async function listCalendars(signal?: AbortSignal): Promise<Calendar[]> {
    return (await apiGet<CalendarDto[]>("/calendars", signal)).map(toCalendar);
  }

  /** A new calendar: the viewer's own, or a space's (its administrators). */
  async function createCalendar(fields: CalendarFields, spaceId?: string): Promise<Calendar> {
    const path = spaceId ? `/organisations/${spaceId}/calendars` : "/calendars";
    return toCalendar(await apiPost<CalendarDto>(path, calendarBody(fields)));
  }

  async function updateCalendar(id: string, fields: Partial<CalendarFields>): Promise<Calendar> {
    return toCalendar(await apiPatch<CalendarDto>(`/calendars/${id}`, calendarBody(fields)));
  }

  /** Delete a calendar and its events, typing its name as a confirmation. */
  async function deleteCalendar(id: string, confirmName: string): Promise<void> {
    await apiRequest<void>("DELETE", `/calendars/${id}`, { json: { confirm_name: confirmName } });
  }

  /** The viewer's own settings for a calendar: shown or hidden, their reminders (`"default"` follows
   *  the calendar's again). */
  async function setCalendarMe(id: string, me: { hidden?: boolean; reminders?: number[] | "default" }): Promise<void> {
    await apiPut<void>(`/calendars/${id}/me`, {
      hidden: me.hidden,
      ...(me.reminders === "default" ? { reminder_default: true } : me.reminders !== undefined ? { reminders: me.reminders } : {}),
    });
  }

  /** What happens in `[from, to)`, in the given calendars (every visible one by default), and the
   *  events seen through an invitation alone unless `invitations` is false. */
  async function listOccurrences(
    from: string,
    to: string,
    calendarIds?: string[],
    signal?: AbortSignal,
    invitations = true,
  ): Promise<Occurrence[]> {
    const params = new URLSearchParams({ from, to });
    if (calendarIds && calendarIds.length > 0) params.set("calendars", calendarIds.join(","));
    if (!invitations) params.set("invitations", "false");
    return (await apiGet<OccurrenceDto[]>(`/calendar/occurrences?${params}`, signal)).map(toOccurrence);
  }

  /** Whom the viewer's calendar is shared with. */
  async function listShares(calendarId: string, signal?: AbortSignal): Promise<Share[]> {
    const rows = await apiGet<{ user_id: string; name: string; level: ShareLevel }[]>(`/calendars/${calendarId}/shares`, signal);
    return rows.map((r) => ({ userId: r.user_id, name: r.name, level: r.level }));
  }

  /** Open the viewer's calendar to someone, or change how far. */
  async function putShare(calendarId: string, userId: string, level: ShareLevel): Promise<void> {
    await apiPut<void>(`/calendars/${calendarId}/shares/${userId}`, { level });
  }

  /** Take a share back. */
  async function deleteShare(calendarId: string, userId: string): Promise<void> {
    await apiDelete<void>(`/calendars/${calendarId}/shares/${userId}`);
  }

  /** Where the PDF of a view is read: the same calendars and invitations as the screen, from the
   *  viewer's first day of the week (0 for Sunday). */
  function printUrl(view: "day" | "week" | "month" | "list" | "year", date: string, calendarIds: string[], invitations: boolean, weekStart: number): string {
    const params = new URLSearchParams({ view, date, week_start: String(weekStart) });
    if (calendarIds.length > 0) params.set("calendars", calendarIds.join(","));
    if (!invitations) params.set("invitations", "false");
    return `${apiBase()}/calendar/print?${params}`;
  }

  /** The events whose words hold `query`, each once: the coming ones on their next date, soonest
   *  first, then the past ones on their last, latest first. */
  async function searchEvents(query: string, signal?: AbortSignal): Promise<Occurrence[]> {
    const params = new URLSearchParams({ q: query });
    return (await apiGet<OccurrenceDto[]>(`/calendar/search?${params}`, signal)).map(toOccurrence);
  }

  async function getEvent(id: string, signal?: AbortSignal): Promise<CalendarEvent> {
    return toEvent(await apiGet<EventDto>(`/events/${id}`, signal));
  }

  async function createEvent(calendarId: string, input: EventInput): Promise<CalendarEvent> {
    return toEvent(await apiPost<EventDto>(`/calendars/${calendarId}/events`, eventBody(input)));
  }

  /** Change one occurrence, the following ones, or the whole series. Answers the changed event (the new
   *  series for `following`). */
  async function updateEvent(id: string, input: EventInput, scope: EditScope, recurrenceId?: string): Promise<CalendarEvent> {
    return toEvent(await apiPatch<EventDto>(`/events/${id}?${scopeQuery(scope, recurrenceId)}`, eventBody(input)));
  }

  async function deleteEvent(id: string, scope: EditScope, recurrenceId?: string): Promise<void> {
    await apiDelete<void>(`/events/${id}?${scopeQuery(scope, recurrenceId)}`);
  }

  /** The viewer's own reminders for an event (its whole series); `"default"` follows their calendar
   *  setting again. */
  async function setEventMe(id: string, reminders: number[] | "default"): Promise<void> {
    await apiPut<void>(`/events/${id}/me`, reminders === "default" ? { reminder_default: true } : { reminders });
  }

  async function listFeeds(signal?: AbortSignal): Promise<Feed[]> {
    return (await apiGet<FeedDto[]>("/calendar/feeds", signal)).map(toFeed);
  }

  /** A new subscription address, for one calendar or (`null`) for all of them. Its URL is shown once. */
  async function createFeed(calendarId: string | null): Promise<CreatedFeed> {
    const dto = await apiPost<FeedDto>("/calendar/feeds", { calendar_id: calendarId });
    return { ...toFeed(dto), url: dto.url ?? "" };
  }

  async function revokeFeed(id: string): Promise<void> {
    await apiDelete<void>(`/calendar/feeds/${id}`);
  }

  /** Answer an invitation, for the series or for one date of it. */
  async function respondToEvent(id: string, status: Exclude<AttendeeStatus, "needs_action">, recurrenceId?: string): Promise<CalendarEvent> {
    return toEvent(await apiPut<EventDto>(`/events/${id}/response`, { status, recurrence_id: recurrenceId }));
  }

  /** When some people are busy over `[from, to)` (31 days at most), leaving out `excludeEvent` (the one
   *  being moved). */
  async function freeBusy(userIds: string[], from: string, to: string, signal?: AbortSignal, excludeEvent?: string): Promise<BusyTimes[]> {
    const found = await apiRequest<{ user_id: string; busy: { start: string; end: string }[] }[]>("POST", "/calendar/freebusy", {
      json: { users: userIds, from, to, exclude_event: excludeEvent },
      signal,
    });
    return found.map((p) => ({ userId: p.user_id, busy: p.busy }));
  }

  /** Where someone invited by address downloads a file of the event, with their page's token. */
  function invitationFileUrl(token: string, fileId: string): string {
    return `${apiBase()}/public/invitation/${encodeURIComponent(token)}/files/${fileId}`;
  }

  /** A channel's next linked occurrences (three at most, within two months). */
  async function listChannelEvents(channelId: string, signal?: AbortSignal): Promise<UpcomingEvent[]> {
    const found = await apiGet<
      { event_id: string; recurrence_id?: string | null; title: string; start: string; end: string; all_day: boolean; location?: string | null }[]
    >(`/channels/${channelId}/events`, signal);
    return found.map((u) => ({
      eventId: u.event_id,
      recurrenceId: opt(u.recurrence_id),
      title: u.title,
      start: u.start,
      end: u.end,
      allDay: u.all_day,
      location: opt(u.location),
    }));
  }

  /** `GET /public/invitation/{token}`: no session needed. A `404` means it is no longer there. */
  async function readInvitation(token: string, signal?: AbortSignal): Promise<PublicInvitation> {
    return toPublicInvitation(await apiGet<PublicInvitationDto>(`/public/invitation/${encodeURIComponent(token)}`, signal));
  }

  /** Answer an invitation from its public page, for every date. */
  async function answerInvitation(token: string, status: Exclude<AttendeeStatus, "needs_action">): Promise<PublicInvitation> {
    return toPublicInvitation(await apiPost<PublicInvitationDto>(`/public/invitation/${encodeURIComponent(token)}`, { status }));
  }

  return {
    listCalendars, createCalendar, updateCalendar, deleteCalendar, setCalendarMe, listOccurrences, listShares, putShare, deleteShare, printUrl, searchEvents, getEvent, createEvent, updateEvent, deleteEvent, setEventMe, listFeeds, createFeed, revokeFeed, respondToEvent, freeBusy, invitationFileUrl, listChannelEvents, readInvitation, answerInvitation,
  };
}

export type CalendarApi = ReturnType<typeof createCalendarApi>;
