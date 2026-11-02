// What the UI knows about the engine connection, kept outside React so it can be tested.
// It follows the shell's engine-state reports, shows the banner while the engine is down,
// and re-requests `status` after every `ready` (AD-16). It holds no product rules.
import type { StatusReport } from "../protocol/generated";
import { EngineStoppedError, type EngineState, type ProtocolClient } from "../protocol/client";

export interface EngineSnapshot {
  state: EngineState;
  /** The current engine's protocol version; null until it is ready. */
  protocolVersion: number | null;
  /** The NFR-10 banner: on while the engine is restarting or has stopped for good. */
  bannerVisible: boolean;
  /** The last `statusReport` from the current engine; null until one arrives. */
  status: StatusReport | null;
}

const INITIAL: EngineSnapshot = { state: "starting", protocolVersion: null, bannerVisible: false, status: null };

export class EngineSession {
  private current: EngineSnapshot = INITIAL;
  private readonly listeners = new Set<(snapshot: EngineSnapshot) => void>();
  private readonly unsubscribers: (() => void)[] = [];
  private active = true;

  constructor(private readonly client: ProtocolClient) {
    this.unsubscribers.push(
      client.onState((state) => this.onState(state)),
      client.onEvent((event) => {
        if (event.type === "ready") this.onReady(event.protocolVersion);
      }),
    );
  }

  get snapshot(): EngineSnapshot {
    return this.current;
  }

  /** Calls `listener` on every change; returns an unsubscribe function. */
  subscribe(listener: (snapshot: EngineSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  start(): Promise<void> {
    return this.client.start();
  }

  stop(): void {
    this.active = false;
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.listeners.clear();
    this.client.stop();
  }

  private onState(state: EngineState): void {
    const down = state === "restarting" || state === "stopped";
    this.update({
      state,
      bannerVisible: down,
      // A stopped engine's version and status describe nothing any more.
      ...(down ? { protocolVersion: null, status: null } : {}),
    });
  }

  private onReady(protocolVersion: number): void {
    this.update({ state: "running", bannerVisible: false, protocolVersion, status: null });
    this.client
      .request({ type: "status" })
      .then((reply) => {
        if (reply.type === "statusReport") this.update({ status: reply });
      })
      .catch((err: unknown) => {
        // A restart ended the request; the next `ready` asks again.
        if (!(err instanceof EngineStoppedError)) console.error("status request failed", err);
      });
  }

  private update(change: Partial<EngineSnapshot>): void {
    if (!this.active) return;
    this.current = { ...this.current, ...change };
    for (const listener of this.listeners) listener(this.current);
  }
}
