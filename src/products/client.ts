/**
 * One instance as the app reaches it: the products its manifest lists, each through its own API and
 * its own access token.
 *
 * The instance is found from its domain (`@ruchoir/native-client`: the hub's manifest, then each
 * product's description), and signing in gives one grant per issuer. Each product here has a
 * transport whose base is the product's origin and whose bearer is the access token issued for
 * that origin (`resource`, RFC 8707), fetched before each request and refreshed by the native
 * client: a token never reaches a product it was not issued for.
 *
 * The screens still call one object (`useApi()`), so the calls of every installed product are
 * gathered here. A call whose product is not installed, or whose route no product serves (the
 * organisation's administration, which belongs to Propolis, and what the products do not do yet),
 * rejects with `ProductUnavailable`; the screens that need one are hidden (`installed`, `available`).
 */
import { NativeError, type Account, type Instance } from "@ruchoir/native-client";

import { native } from "./auth.ts";
import { createCalendarApi, type CalendarApi } from "./calendar/api.ts";
import { createChatApi, type ChatApi } from "./chat/api.ts";
import { createDriveApi, type DriveApi } from "./drive/api.ts";
import { createHubApi, type HubApi } from "./hub/api.ts";
import { createInboxApi, type InboxApi } from "./hub/inbox.ts";
import { withOptions, type ClientOptions } from "./shared/config.ts";
import { ApiError, makeTransport, type Transport } from "./shared/http.ts";
import type { InstanceCapabilities, SessionUser } from "./shared/model.ts";
import type { Group, Role, Workspace } from "./shared/types.ts";
import { UNAVAILABLE, type UnavailableCalls } from "./unavailable.ts";

/** The products the app has screens for, as the manifest names them. */
export type ProductName = "hub" | "chat" | "drive" | "calendar";

/** A call no installed product serves. */
export class ProductUnavailable extends Error {
  constructor(readonly call: string) {
    super(`${call}: no product of this instance serves it`);
    this.name = "ProductUnavailable";
  }
}


type Extras = {
  /** The instance as discovered: its domain, its issuer and its products. */
  instance: Instance;
  /** Whether the manifest lists `product` (and the product answered its description). */
  installed: (product: ProductName) => boolean;
  /** Whether a call is served by an installed product. */
  available: (call: string) => boolean;
  /** The person signed in, from the ID token. */
  getSession: () => Promise<SessionUser>;
  /** The person's organisations, from the first installed product that lists them. */
  getWorkspaces: (signal?: AbortSignal) => Promise<Workspace[]>;
  /** What the instance can do, from the products' descriptions. */
  getInstanceCapabilities: (signal?: AbortSignal) => Promise<InstanceCapabilities>;
  /** Sign out: Propolis revokes the grant, every product's token goes with it. */
  logout: () => Promise<void>;
  /** The hub's address, for a link that names the instance. */
  absoluteUrl: (pathOrUrl: string) => string;
  /** The bearer for a URL the app fetches itself (an image, a download), only for its own product. */
  authInit: (url?: string) => { credentials: RequestCredentials; headers: Record<string, string> };
  options: () => ClientOptions;
};

export type RuchoirClient = ChatApi & DriveApi & CalendarApi & HubApi & InboxApi & UnavailableCalls & Extras & {
  listRoles: (spaceId: string, signal?: AbortSignal) => Promise<Role[]>;
  listGroups: (spaceId: string, signal?: AbortSignal) => Promise<Group[]>;
};

export type ClientHooks = {
  locale: () => string;
  /** The grant ended (revoked, spent): the instance is signed out. */
  onSignedOut: () => void;
  openSocket?: (url: string, authorization: string | null) => WebSocket;
};

/** The options shared by every product's transport but its address and token. */
function productTransport(instance: Instance, url: string, hooks: ClientHooks): Transport {
  let bearer: string | null = null;
  const options = withOptions({
    baseUrl: url,
    sessionDelivery: "token",
    locale: hooks.locale,
    authorization: () => (bearer ? `Bearer ${bearer}` : null),
    prepare: async () => {
      try {
        bearer = await native.accessToken(instance.issuer, url);
      } catch (err) {
        if (err instanceof NativeError && (err.code === "signed_out" || err.code === "session_ended")) {
          bearer = null;
          hooks.onSignedOut();
          throw new ApiError(401, "signed out", { error: err.code });
        }
        throw err;
      }
    },
    openSocket: (socketUrl) => (hooks.openSocket ? hooks.openSocket(socketUrl, bearer ? `Bearer ${bearer}` : null) : new WebSocket(socketUrl)),
    onUnauthorized: () => {},
  });
  return makeTransport(() => options);
}

function unavailable(call: string): () => Promise<never> {
  return () => Promise.reject(new ProductUnavailable(call));
}

/** The calls of a product's API, or calls that reject when the product is not installed. */
function orUnavailable<T extends object>(api: T | null, sample: T): T {
  if (api) return api;
  return Object.fromEntries(Object.keys(sample).map((name) => [name, unavailable(name)])) as T;
}

/** The person as the ID token names them, in the shape the screens read. */
export function sessionUser(account: Account): SessionUser {
  return {
    id: account.subject,
    email: account.email ?? "",
    name: account.name ?? account.email ?? "",
    presenceChoice: "auto",
    isInstanceAdmin: false,
  };
}

export function createInstanceClient(instance: Instance, hooks: ClientHooks): RuchoirClient {
  const product = (name: ProductName) => instance.products.find((p) => p.name === name && p.description !== null);
  const transports = new Map<ProductName, Transport>();
  for (const name of ["hub", "chat", "drive", "calendar"] as const) {
    const found = product(name);
    if (found) transports.set(name, productTransport(instance, found.url, hooks));
  }
  // A transport that is never used, so the shape of an absent product's API can be listed.
  const blank = makeTransport(() => withOptions({ baseUrl: "https://invalid" }));
  const t = (name: ProductName) => transports.get(name) ?? null;
  const chat = orUnavailable(t("chat") && createChatApi(t("chat")!), createChatApi(blank));
  const drive = orUnavailable(t("drive") && createDriveApi(t("drive")!), createDriveApi(blank));
  const calendar = orUnavailable(t("calendar") && createCalendarApi(t("calendar")!), createCalendarApi(blank));
  const hub = orUnavailable(t("hub") && createHubApi(t("hub")!), createHubApi(blank));
  const inbox = orUnavailable(t("hub") && createInboxApi(t("hub")!), createInboxApi(blank));

  const served = new Set<string>();
  for (const [name, api] of [["chat", chat], ["drive", drive], ["calendar", calendar], ["hub", hub], ["hub", inbox]] as const) {
    if (transports.has(name)) for (const call of Object.keys(api)) served.add(call);
  }

  const stubs = Object.fromEntries(UNAVAILABLE.map((name) => [name, unavailable(name)])) as unknown as UnavailableCalls;
  // The groups and the roles are Propolis's: none is listed, so the screens fall back to the members.
  const none = async () => [];

  const listing = (["chat", "drive", "calendar"] as const).map(t).find((x): x is Transport => x !== null);
  const getWorkspaces = async (signal?: AbortSignal): Promise<Workspace[]> => {
    if (!listing) return [];
    const rows = await listing.apiGet<{ id: string; name: string }[]>("/me/organisations", signal);
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      members: 0,
      role: "member",
      slug: row.id,
      unread: 0,
      mentions: 0,
      notifyLevel: "default",
      edition: "community",
    }));
  };

  const getInstanceCapabilities = async (): Promise<InstanceCapabilities> => {
    const features = [...new Set(instance.products.flatMap((p) => p.description?.features ?? []))];
    return {
      emailDelivery: true,
      office: { enabled: false, edit: [], view: [], convert: [] },
      publicLinks: product("drive") !== undefined,
      nativeSessions: true,
      apiVersion: 1,
      features,
    };
  };

  const getSession = async (): Promise<SessionUser> => {
    const account = await native.account(instance.issuer);
    if (!account) throw new ApiError(401, "signed out", { error: "signed_out" });
    return sessionUser(account);
  };

  const ownerOf = (url: string): Transport | null => {
    for (const [name, transport] of transports) {
      const base = product(name)?.url;
      if (base && (url === base || url.startsWith(`${base}/`))) return transport;
    }
    return null;
  };

  const hubUrl = product("hub")?.url ?? `https://hub.${instance.domain}`;
  const extras: Extras = {
    instance,
    installed: (name) => transports.has(name),
    available: (call) => served.has(call),
    getSession,
    getWorkspaces,
    getInstanceCapabilities,
    logout: () => native.signOut(instance.issuer),
    absoluteUrl: (pathOrUrl) => (pathOrUrl.startsWith("/") ? `${hubUrl}${pathOrUrl}` : pathOrUrl),
    authInit: (url) => {
      const owner = url ? ownerOf(url) : null;
      return owner ? owner.authInit() : { credentials: "omit", headers: {} };
    },
    options: () => withOptions({ baseUrl: hubUrl }),
  };

  return { ...stubs, ...chat, ...drive, ...calendar, ...hub, ...inbox, listRoles: none, listGroups: none, ...extras };
}
