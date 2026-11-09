// What the browse list shows, kept outside React so it can be tested. After every `ready` it
// asks the engine for Documents. The last listing stays through engine restarts. It holds no
// product rules: the engine filters and types the entries, the catalog words them.
import type { FolderListing } from "../protocol/generated";
import { EngineStoppedError, type ProtocolClient } from "../protocol/client";

export interface BrowseSnapshot {
  /** The last folder listing; kept while a newer one loads and while the engine restarts. */
  listing: FolderListing | null;
  /** The engine's error code for the last request (e.g. `accessDenied`); null after a listing. */
  error: string | null;
  /** A listing request is waiting for its reply. */
  loading: boolean;
}

const INITIAL: BrowseSnapshot = { listing: null, error: null, loading: false };

export class BrowseSession {
  private current: BrowseSnapshot = INITIAL;
  private readonly listeners = new Set<(snapshot: BrowseSnapshot) => void>();
  private readonly unsubscribe: () => void;
  private active = true;
  /** Counts list requests, so only the newest one's reply is shown. */
  private latest = 0;

  constructor(private readonly client: ProtocolClient) {
    this.unsubscribe = client.onEvent((event) => {
      if (event.type === "ready") this.list();
    });
  }

  get snapshot(): BrowseSnapshot {
    return this.current;
  }

  /** Calls `listener` on every change; returns an unsubscribe function. */
  subscribe(listener: (snapshot: BrowseSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Asks for a folder's listing: Documents when `path` is left out. */
  list(path?: string): void {
    const request = ++this.latest;
    this.update({ loading: true });
    this.client
      .request(path === undefined ? { type: "listFolder" } : { type: "listFolder", path })
      .then((reply) => {
        if (request !== this.latest) return; // a newer request owns the list
        if (reply.type === "folderListing") this.update({ listing: reply, error: null, loading: false });
        else if (reply.type === "error") this.update({ listing: null, error: reply.code, loading: false });
        // `cancelled`: a newer request replaced this one, and its reply is on the way.
      })
      .catch((err: unknown) => {
        if (request !== this.latest) return;
        // A restart ended the request: keep what is on screen, the next `ready` lists again.
        this.update({ loading: false });
        if (!(err instanceof EngineStoppedError)) console.error("listFolder request failed", err);
      });
  }

  stop(): void {
    this.active = false;
    this.unsubscribe();
    this.listeners.clear();
  }

  private update(change: Partial<BrowseSnapshot>): void {
    if (!this.active) return;
    this.current = { ...this.current, ...change };
    for (const listener of this.listeners) listener(this.current);
  }
}
