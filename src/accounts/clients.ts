/**
 * The phone's clients, one per instance (ADR 0002), each reaching the products its manifest lists
 * with their own access tokens (`products/client.ts`).
 *
 * Kept outside React: a client lives as long as the app. The tokens are the native client's, never
 * held here.
 */
import { createInstanceClient, type RuchoirClient } from "../products/index.ts";

import i18n from "../i18n";
import type { InstanceEntry } from "./registry";

/** React Native's `WebSocket` constructor, which takes request headers as a third argument. */
type NativeWebSocket = new (
  url: string,
  protocols?: string | string[],
  options?: { headers: Record<string, string> },
) => WebSocket;

export class InstanceClients {
  private readonly clients = new Map<string, RuchoirClient>();
  private signedOut: (id: string) => void = () => {};

  /** The client of an instance, made the first time it is asked for (again when its discovery changed). */
  client(entry: InstanceEntry): RuchoirClient {
    let client = this.clients.get(entry.id);
    if (!client || client.instance !== entry.instance) {
      client = createInstanceClient(entry.instance, {
        locale: () => i18n.language,
        onSignedOut: () => this.signedOut(entry.id),
        // The hub's socket carries the hub's bearer (React Native's `WebSocket` takes headers).
        openSocket: (url, authorization) =>
          new (WebSocket as unknown as NativeWebSocket)(url, undefined, { headers: authorization ? { authorization } : {} }),
      });
      this.clients.set(entry.id, client);
    }
    return client;
  }

  /** Forget an instance's client, when the instance is removed from the phone. */
  drop(id: string): void {
    this.clients.delete(id);
  }

  /** What an ended grant does (the accounts sign the instance out). */
  onSignedOut(handler: (id: string) => void): void {
    this.signedOut = handler;
  }
}
