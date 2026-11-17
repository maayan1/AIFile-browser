// Protocol client: the UI's only way to talk to the engine.
// Lines travel through the Rust shell (Tauri command `engine_send`, event `engine-message`);
// JavaScript never spawns, restarts or kills the engine process (AD-14). The shell reports the
// engine's state (`engine-state`); on a restart every pending request ends here (AD-16).
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  Cancel,
  Cancelled,
  CreateFile,
  ErrorMessage,
  FileCreated,
  FolderListing,
  ListFolder,
  ListLocations,
  Locations,
  NameMatches,
  Ping,
  Pong,
  ProtocolMessage,
  Ready,
  Search,
  SearchDone,
  SearchParsed,
  ShowInFolder,
  Status,
  StatusReport,
} from "./generated";

/** Requests the UI may send; the client adds the `id`. A `cancel` goes through `cancel(id)`. */
export type Request =
  | Omit<Ping, "id">
  | Omit<Status, "id">
  | Omit<ListFolder, "id">
  | Omit<ShowInFolder, "id">
  | Omit<ListLocations, "id">
  | Omit<Search, "id">
  | Omit<CreateFile, "id">;
/**
 * Terminal replies, matched to a request by `id`. `cancelled` ends a request that a newer one on
 * the same engine channel replaced (latest wins), or that a `cancel` with its id stopped.
 */
export type Reply =
  | Pong
  | StatusReport
  | FolderListing
  | Locations
  | SearchDone
  | FileCreated
  | Cancelled
  | ErrorMessage;
/** Non-terminal replies: a `search` sends these on its id before its terminal reply (AD-15). */
export type StreamMessage = SearchParsed | NameMatches;
const STREAM_TYPES: ReadonlySet<string> = new Set<StreamMessage["type"]>(["searchParsed", "nameMatches"]);
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
  /** A `stream` request's listener for its non-terminal replies. */
  onMessage?: (message: StreamMessage) => void;
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
    return this.dispatch(message);
  }

  /**
   * Sends a request whose replies come in several messages: `onMessage` gets each non-terminal
   * one (`searchParsed`, `nameMatches`) in order, and the promise resolves with the terminal
   * reply. An engine restart rejects it with EngineStoppedError, as it does `request`. `onId` is
   * told the request's id before it is sent, so the caller can `cancel` it.
   */
  stream(message: Request, onMessage: (message: StreamMessage) => void, onId?: (id: string) => void): Promise<Reply> {
    return this.dispatch(message, onMessage, onId);
  }

  /**
   * Asks the engine to stop the request `id`. It only sends: a cancel has no reply of its own, and
   * the request's own terminal reply ends it as usual: `cancelled`, unless its terminal reply had
   * already been sent when the cancel arrived.
   * An unknown or finished id does nothing. A failed send is ignored: an engine that isn't running
   * ends every pending request through its restart anyway.
   */
  cancel(id: string): void {
    const message: Cancel = { id, type: "cancel" };
    this.transport.send(JSON.stringify(message)).catch(() => {});
  }

  private dispatch(
    message: Request,
    onMessage?: (message: StreamMessage) => void,
    onId?: (id: string) => void,
  ): Promise<Reply> {
    const id = this.newId();
    onId?.(id);
    return new Promise<Reply>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onMessage });
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
    if (!pending) return;
    if (STREAM_TYPES.has(message.type)) {
      // Never terminal: the request stays pending until its terminal reply.
      pending.onMessage?.(message as StreamMessage);
      return;
    }
    this.pending.delete(message.id);
    pending.resolve(message as Reply);
  }
}
