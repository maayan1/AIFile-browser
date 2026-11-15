// The search model, kept outside React so it can be tested: whether the search view is open, the
// folder searched, the latest search's parsed text, its name matches so far and its end. One Enter
// sends one `search`; its replies arrive on its id in order (searchParsed, nameMatches batches, then
// searchDone or cancelled). A newer search replaces the running one: the engine ends the old one
// with `cancelled`, and anything still arriving for it is ignored here. Closing the view drops
// anything still arriving too. It holds no product rules: the engine matches and decides (its
// `outcomeCode`); the result list renders.
import type { Place } from "../browse/session";
import type { FileMatch, FolderMatch, SearchDone, SearchParsed } from "../protocol/generated";
import { EngineStoppedError, type ProtocolClient, type Reply, type StreamMessage } from "../protocol/client";

export type NameMatch = FolderMatch | FileMatch;

export interface SearchSnapshot {
  /** The search view is open: from Enter until Esc, ✕ or a navigation closes it. */
  open: boolean;
  /** The searched folder's place, which names the start of each match's location; null when closed. */
  root: Place | null;
  /** A search is waiting for its terminal reply (the spinner shows). */
  running: boolean;
  /** How the engine read the latest search's text; null until it says. */
  parsed: SearchParsed | null;
  /** The latest search's name matches so far, in arrival order. */
  matches: NameMatch[];
  /** The latest search's `searchDone`; null while it runs, or when it ended otherwise. */
  done: SearchDone | null;
  /** The engine's error code for the latest search (e.g. `folderNotFound`); null otherwise. */
  error: string | null;
}

/** What the views may ask the search session to do. */
export interface SearchActions {
  /**
   * Opens the search view and searches the folder at `place` and its subfolders for `text`;
   * whitespace-only text sends nothing.
   */
  search(text: string, place: Place): void;
  /** Closes the search view: back to the snapshot before any search; late replies are dropped. */
  close(): void;
}

/** The snapshot before anything is searched. */
export const INITIAL_SEARCH: SearchSnapshot = {
  open: false,
  root: null,
  running: false,
  parsed: null,
  matches: [],
  done: null,
  error: null,
};

/** Sees each reply of a search, for the dev console. Never given the search text. */
export type SearchTrace = (id: string | null, type: string, detail?: Record<string, unknown>) => void;

export class SearchSession implements SearchActions {
  private current: SearchSnapshot = INITIAL_SEARCH;
  private readonly listeners = new Set<(snapshot: SearchSnapshot) => void>();
  private active = true;
  /** Counts searches, so only the newest one's replies are kept. */
  private latest = 0;

  constructor(
    private readonly client: ProtocolClient,
    private readonly trace?: SearchTrace,
  ) {}

  get snapshot(): SearchSnapshot {
    return this.current;
  }

  /** Calls `listener` on every change; returns an unsubscribe function. */
  subscribe(listener: (snapshot: SearchSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  search(text: string, place: Place): void {
    if (!text.trim()) return;
    const search = ++this.latest;
    this.update({ open: true, root: place, running: true, parsed: null, matches: [], done: null, error: null });
    this.client
      .stream({ type: "search", text, folder: place.path }, (message) => {
        this.traced(message);
        if (search !== this.latest) return; // a newer search owns the results
        if (message.type === "searchParsed") this.update({ parsed: message });
        else this.update({ matches: [...this.current.matches, ...message.matches] });
      })
      .then((reply) => {
        this.traced(reply);
        if (search !== this.latest) return;
        if (reply.type === "searchDone") this.update({ running: false, done: reply });
        else if (reply.type === "error") this.update({ running: false, error: reply.code });
        else this.update({ running: false }); // cancelled
      })
      .catch((err: unknown) => {
        if (search !== this.latest) return;
        // A restart ended the search: nothing more will arrive for it.
        this.update({ running: false });
        if (!(err instanceof EngineStoppedError)) console.error("search request failed", err);
      });
  }

  close(): void {
    // Replies still arriving for the closed search are dropped; the engine finishes it on its own
    // (sending `cancel` is Story 2.3).
    ++this.latest;
    if (this.current.open) this.update(INITIAL_SEARCH);
  }

  stop(): void {
    this.active = false;
    this.listeners.clear();
  }

  /** Reports a reply to the trace: its id, type and counts, never the text it was asked. */
  private traced(message: StreamMessage | Reply): void {
    if (!this.trace) return;
    if (message.type === "nameMatches") this.trace(message.id, message.type, { matches: message.matches.length });
    else if (message.type === "error") this.trace(message.id, message.type, { code: message.code });
    else this.trace(message.id, message.type);
  }

  private update(change: Partial<SearchSnapshot>): void {
    if (!this.active) return;
    this.current = { ...this.current, ...change };
    for (const listener of this.listeners) listener(this.current);
  }
}
