// The preview model, kept outside React so it can be tested: the item selected in the browse list
// or Name matches, and its `previewReady` once the engine sends it. A file's selection sends one
// `preview`; a folder, or no selection, sends nothing. A newer selection replaces the older one:
// the engine's preview channel is latest-wins, so it ends the older request with `cancelled`, and
// any reply for an older selection is dropped here, so holding ↓ shows only the last file. It holds
// no product rules: the engine decides which thumbnail a file gets and why it has none; the panel
// renders.
import type { FileEntry, PreviewReady } from "../protocol/generated";
import { EngineStoppedError, type ProtocolClient } from "../protocol/client";

/** A selected row, as the lists know it: enough for the panel's details before any reply. */
export type PreviewItem =
  | { kind: "folder"; path: string; name: string; modified: string | null }
  | {
      kind: "file";
      path: string;
      name: string;
      typeCode: FileEntry["typeCode"];
      /** Null when the list doesn't know it (a name match); the reply's details fill it. */
      size: number | null;
      modified: string | null;
    };

export interface PreviewSnapshot {
  /** The file whose preview is shown or awaited; null with no file selected. */
  path: string | null;
  /** That file's reply; null while it loads, and when it failed. */
  reply: PreviewReady | null;
  /** A preview request for `path` is waiting for its reply. */
  loading: boolean;
  /** The request for `path` ended without a reply: an engine error or restart. */
  failed: boolean;
}

/** What the views may ask the preview session to do. */
export interface PreviewActions {
  /** Shows `item` in the Preview Panel: a file is previewed, a folder or null clears it. */
  select(item: PreviewItem | null): void;
}

/**
 * How long a selection waits for its reply before the panel says the file can't be read: the
 * engine's 2 s read deadline plus slack. An engine call stuck in the OS (a dead share) never
 * replies, and the skeleton must not stay up forever.
 */
export const PREVIEW_TIMEOUT_MS = 2500;

/** The snapshot before anything is selected. */
export const INITIAL_PREVIEW: PreviewSnapshot = { path: null, reply: null, loading: false, failed: false };

/** The key that tells two selections apart: a new key is a new preview, the same one is not. */
export function previewKey(item: PreviewItem | null): string | null {
  if (!item) return null;
  return item.kind === "folder" ? `folder:${item.path}` : `file:${item.path}:${item.size}:${item.modified}`;
}

export class PreviewSession implements PreviewActions {
  private current: PreviewSnapshot = INITIAL_PREVIEW;
  private readonly listeners = new Set<(snapshot: PreviewSnapshot) => void>();
  private active = true;
  /** Counts selections, so only the newest one's reply is shown. */
  private latest = 0;
  /** The latest selection's timeout, until its reply arrives. */
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly client: ProtocolClient) {}

  get snapshot(): PreviewSnapshot {
    return this.current;
  }

  /** Calls `listener` on every change; returns an unsubscribe function. */
  subscribe(listener: (snapshot: PreviewSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  select(item: PreviewItem | null): void {
    const selection = ++this.latest;
    this.clearTimer();
    if (!item || item.kind !== "file") {
      // EARS-02: nothing to preview, and nothing to ask the engine.
      this.update(INITIAL_PREVIEW);
      return;
    }
    const path = item.path;
    this.update({ path, reply: null, loading: true, failed: false });
    this.timer = setTimeout(() => {
      this.timer = null;
      if (selection !== this.latest) return;
      // Too late: a reply that still comes for this selection is dropped.
      this.latest++;
      this.update({ path, reply: null, loading: false, failed: true });
    }, PREVIEW_TIMEOUT_MS);
    this.client
      .request({ type: "preview", path })
      .then((reply) => {
        if (selection !== this.latest) return; // a newer selection, or the timeout, owns the panel
        this.clearTimer();
        if (reply.type === "previewReady") this.update({ path, reply, loading: false, failed: false });
        else this.update({ path, reply: null, loading: false, failed: true }); // an error, or a cancel nothing replaced
      })
      .catch((err: unknown) => {
        if (selection !== this.latest) return;
        this.clearTimer();
        // A restart ended the request: the panel says the file can't be read.
        this.update({ path, reply: null, loading: false, failed: true });
        if (!(err instanceof EngineStoppedError)) console.error("preview request failed", err);
      });
  }

  stop(): void {
    this.active = false;
    this.clearTimer();
    this.listeners.clear();
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private update(next: PreviewSnapshot): void {
    if (!this.active) return;
    this.current = next;
    for (const listener of this.listeners) listener(this.current);
  }
}
