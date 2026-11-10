/**
 * The hub's API (`contract/openapi-v1.json` of Ruchoir/hub): presence, notification preferences and
 * the phone's push registration. The inbox is in `inbox.ts`.
 *
 * Each call is the route of the product, made with its own access token (`../http`).
 */
import type { Transport } from "../shared/http.ts";
import { type Presence, type PresenceChoice } from "../shared/types.ts";
import { fromNotificationPrefs, toNotificationPrefs, toPresence } from "../shared/model.ts";
import type { NotificationPreferences, NotificationPrefsDto, PresenceDto, PushConfig, RealtimeConnection, RealtimeEnvelope, RealtimeHandlers } from "../shared/model.ts";
import { dispatchFrame } from "./live.ts";

export function createHubApi(transport: Transport) {
  const { apiRequest, apiGet, apiPost, apiPut, apiOrigin, clientOptions } = transport;

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
    for (const row of rows) out[row.account] = toPresence(row.presence);
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
    await apiPut<void>("/me/presence", { choice: manual });
    // The hub answers 204: what results is read back, the server's own answer.
    const dto = await apiGet<{ presence: string; choice?: string | null }>("/me/presence");
    return toPresence(dto.presence);
  }

  /** `GET /me/notification-preferences`: the hub's `NotificationPrefs`, by category. */
  async function getNotificationPreferences(signal?: AbortSignal): Promise<NotificationPreferences> {
    return fromNotificationPrefs(await apiGet<NotificationPrefsDto>("/me/notification-preferences", signal));
  }

  /** `PUT /me/notification-preferences`: replace them whole. */
  async function saveNotificationPreferences(prefs: NotificationPreferences): Promise<void> {
    await apiPut<void>("/me/notification-preferences", toNotificationPrefs(prefs));
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


  // --- Realtime (WebSocket) ---

  /** The realtime socket's address: `wss://` on the instance's origin (`ws://` only for plain http). */
  function realtimeSocketUrl(): string {
    return `${apiOrigin().replace(/^http/, "ws")}/api/v1/live/ws`;
  }

  /**
   * Open the hub's live socket and dispatch the frames it carries to `handlers`.
   *
   * The socket is the hub's (`GET /api/v1/live/ws`): an app opens it with its own access token for
   * the hub, which `openSocket` adds as the bearer. It only receives: each frame is a product's
   * `ClientFrame` (`{ v, type, scope?, payload }`), named after its product (`chat.message.created`,
   * `drive.files.updated`, `calendar.changed`, `hub.inbox.new`), and the hub forwards it unread. The
   * hub pings the socket itself; typing goes to the chat (`sendTyping` of the chat's API). The
   * socket reconnects with a capped backoff after any close. React Native has no `EventSource`, so
   * there is no server-sent events fallback here.
   *
   * All mutations still go through each product's REST API; this only receives.
   */
  function connectRealtime(handlers: RealtimeHandlers): RealtimeConnection {
    let socket: WebSocket | null = null;
    let closed = false;
    let reconnectDelay = 1000;
    /** Whether a connection has been up before, which makes the next one a reconnection. */
    let everOpened = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      if (closed) return;
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
        if (everOpened) handlers.onReconnect?.();
        everOpened = true;
      };
      ws.onmessage = (event) => {
        try {
          dispatchFrame(JSON.parse(event.data as string) as RealtimeEnvelope, handlers);
        } catch {
          // Ignore an unparseable frame rather than tearing the connection down.
        }
      };
      ws.onclose = () => {
        if (!closed) scheduleReconnect();
      };
      ws.onerror = () => {
        // The close handler drives reconnection; nothing extra to do here.
      };
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
        clearTimeout(reconnectTimer);
        socket?.close();
      },
      // Replaced by the client with the chat's `POST /conversations/{id}/typing`: the hub's socket
      // carries nothing upwards.
      sendTyping: () => {},
    };
  }

  return {
    getSpacePresence, setMyPresence, getNotificationPreferences, saveNotificationPreferences, getPushConfig, registerPushDevice, forgetPushDevice, sendPhoneTestPush, connectRealtime, realtimeSocketUrl,
  };
}

export type HubApi = ReturnType<typeof createHubApi>;
