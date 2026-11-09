// Protocol client: the UI's only way to talk to the engine.
// Lines travel through the Rust shell (Tauri command `engine_send`, event `engine-message`);
// JavaScript never spawns, restarts or kills the engine process (AD-14). The shell reports the
// engine's state (`engine-state`); on a restart every pending request ends here (AD-16).
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  Cancelled,
  ErrorMessage,
  FolderListing,
  ListFolder,
  ListLocations,
  Locations,
  Ping,
  Pong,
  ProtocolMessage,
  Ready,
  Status,
  StatusReport,
} from "./generated";

/** Requests the UI may send; the client adds the `id`. */
export type Request = Omit<Ping, "id"> | Omit<Status, "id"> | Omit<ListFolder, "id"> | Omit<ListLocations, "id">;
/**
 * Terminal replies, matched to a request by `id`. `cancelled` ends a request that a newer one on
 * the same engine channel replaced (latest wins).
 */
export type Reply = Pong | StatusReport | FolderListing | Locations | Cancelled | ErrorMessage;
/** Unsolicited engine messages (`id: null`). */
export type EngineEvent = Ready | (ErrorMessage & { id: null });
/** The engine state as the shell's supervisor reports it. */
export type EngineState = "starting" | "running" | "restarting" | "stopped";

/** Moves raw JSON lines and engine-state reports between the client and the shell. */
export interface Transport {
  send(line: string): Promise<void>;
  /** Calls `onLine` for every engine line; resolves to an unsubscribe function. */
  subscribe(onLine: (line: string) => void): Promise<() => void>;
  /** The current engine's `ready` line, if it arrived before this page subscribed. */
  lastReady(): Promise<string | null>;
  /** Calls `onState` on every engine-state change; resolves to an unsubscribe function. */
  subscribeState(onState: (state: EngineState) => void): Promise<() => void>;
  /** The engine state now, for a page that loads after the last change. */
  currentState(): Promise<EngineState>;
}

export const ENGINE_MESSAGE_EVENT = "engine-message";
export const ENGINE_STATE_EVENT = "engine-state";

export function tauriTransport(): Transport {
  return {
    send: (line) => invoke<void>("engine_send", { line }),
    subscribe: (onLine) => listen<string>(ENGINE_MESSAGE_EVENT, (event) => onLine(event.payload)),
    lastReady: () => invoke<string | null>("engine_ready"),
    subscribeState: (onState) => listen<EngineState>(ENGINE_STATE_EVENT, (event) => onState(event.payload)),
    currentState: () => invoke<EngineState>("engine_state"),
  };
}

/** A request ended because the engine stopped or is restarting; it never got a reply. */
export class EngineStoppedError extends Error {
  constructor() {
    super("engine stopped before replying");
    this.name = "EngineStoppedError";
  }
}

interface Pending {
  resolve: (reply: Reply) => void;
  reject: (err: unknown) => void;
}

export class ProtocolClient {
  private readonly pending = new Map<string, Pending>();
  private readonly listeners = new Set<(event: EngineEvent) => void>();
  private readonly stateListeners = new Set<(state: EngineState) => void>();
  private unsubscribers: (() => void)[] = [];
  private stopped = false;
  private readySeen = false;
  private stateSeen = false;

  constructor(
    private readonly transport: Transport,
    private readonly newId: () => string = () => crypto.randomUUID(),
  ) {}

  /**
   * Starts receiving. The fetched state and cached `ready` are replayed only if no live
   * state change or `ready` arrived meanwhile (a live one is newer).
   */
  async start(): Promise<void> {
    const unsubscribers = await Promise.all([
      this.transport.subscribe((line) => this.receive(line)),
      this.transport.subscribeState((state) => this.receiveState(state)),
    ]);
    if (this.stopped) {
      for (const unsubscribe of unsubscribers) unsubscribe();
      return;
    }
    this.unsubscribers = unsubscribers;
    const state = await this.transport.currentState();
    if (!this.stopped && !this.stateSeen) this.receiveState(state);
    const ready = await this.transport.lastReady();
    if (ready !== null && !this.stopped && !this.readySeen) this.receive(ready);
  }

  stop(): void {
    this.stopped = true;
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.unsubscribers = [];
    this.pending.clear();
    this.listeners.clear();
    this.stateListeners.clear();
  }

  /** Sends a request and resolves with its terminal reply (an `error` reply resolves too). */
  request(message: Request): Promise<Reply> {
    const id = this.newId();
    return new Promise<Reply>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.transport.send(JSON.stringify({ ...message, id })).catch((err: unknown) => {
        if (this.pending.delete(id)) reject(err);
      });
    });
  }

  /** Listens for `id: null` events; returns an unsubscribe function. */
  onEvent(listener: (event: EngineEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Listens for engine-state changes; returns an unsubscribe function. */
  onState(listener: (state: EngineState) => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  /** Handles one engine-state report from the shell. Exposed for tests. */
  receiveState(state: EngineState): void {
    this.stateSeen = true;
    if (state === "restarting" || state === "stopped") {
      // The old engine is gone: nothing it was asked will ever be answered, and its `ready`
      // no longer counts, so the next engine's cached `ready` may be replayed.
      this.readySeen = false;
      const ended = [...this.pending.values()];
      this.pending.clear();
      for (const { reject } of ended) reject(new EngineStoppedError());
    }
    for (const listener of this.stateListeners) listener(state);
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
    const pending = this.pending.get(message.id);
    if (pending) {
      this.pending.delete(message.id);
      pending.resolve(message as Reply);
    }
  }
}
