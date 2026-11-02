// Protocol client: the UI's only way to talk to the engine.
// Lines travel through the Rust shell (Tauri command `engine_send`, event `engine-message`);
// JavaScript never spawns or controls the engine process (AD-14).
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ErrorMessage, Ping, Pong, ProtocolMessage, Ready } from "./generated";

/** Requests the UI may send; the client adds the `id`. */
export type Request = Omit<Ping, "id">;
/** Terminal replies, matched to a request by `id`. */
export type Reply = Pong | ErrorMessage;
/** Unsolicited engine messages (`id: null`). */
export type EngineEvent = Ready | (ErrorMessage & { id: null });

/** Moves raw JSON lines between the client and the shell. */
export interface Transport {
  send(line: string): Promise<void>;
  /** Calls `onLine` for every engine line; resolves to an unsubscribe function. */
  subscribe(onLine: (line: string) => void): Promise<() => void>;
  /** The engine's last `ready` line, if it arrived before this page subscribed. */
  lastReady(): Promise<string | null>;
}

export const ENGINE_MESSAGE_EVENT = "engine-message";

export function tauriTransport(): Transport {
  return {
    send: (line) => invoke<void>("engine_send", { line }),
    subscribe: (onLine) => listen<string>(ENGINE_MESSAGE_EVENT, (event) => onLine(event.payload)),
    lastReady: () => invoke<string | null>("engine_ready"),
  };
}

export class ProtocolClient {
  private readonly pending = new Map<string, (reply: Reply) => void>();
  private readonly listeners = new Set<(event: EngineEvent) => void>();
  private unsubscribe: (() => void) | null = null;
  private stopped = false;
  private readySeen = false;

  constructor(
    private readonly transport: Transport,
    private readonly newId: () => string = () => crypto.randomUUID(),
  ) {}

  /** Starts receiving; replays a cached `ready` only if no live `ready` has arrived meanwhile. */
  async start(): Promise<void> {
    const unsubscribe = await this.transport.subscribe((line) => this.receive(line));
    if (this.stopped) {
      unsubscribe();
      return;
    }
    this.unsubscribe = unsubscribe;
    const ready = await this.transport.lastReady();
    if (ready !== null && !this.stopped && !this.readySeen) this.receive(ready);
  }

  stop(): void {
    this.stopped = true;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.pending.clear();
    this.listeners.clear();
  }

  /** Sends a request and resolves with its terminal reply (an `error` reply resolves too). */
  request(message: Request): Promise<Reply> {
    const id = this.newId();
    return new Promise<Reply>((resolve, reject) => {
      this.pending.set(id, resolve);
      this.transport.send(JSON.stringify({ ...message, id })).catch((err: unknown) => {
        this.pending.delete(id);
        reject(err);
      });
    });
  }

  /** Listens for `id: null` events; returns an unsubscribe function. */
  onEvent(listener: (event: EngineEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Handles one raw line from the engine. Exposed for tests. */
  receive(line: string): void {
    let message: ProtocolMessage;
    try {
      message = JSON.parse(line) as ProtocolMessage;
    } catch {
      return;
    }
    if (message === null || typeof message !== "object") return;
    if (message.id === null) {
      if (message.type === "ready") this.readySeen = true;
      for (const listener of this.listeners) listener(message as EngineEvent);
      return;
    }
    const resolve = this.pending.get(message.id);
    if (resolve) {
      this.pending.delete(message.id);
      resolve(message as Reply);
    }
  }
}
