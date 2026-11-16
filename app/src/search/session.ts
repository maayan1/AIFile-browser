// The search model, kept outside React so it can be tested: whether the search view is open, the
// folder searched, the latest search's parsed text, its name matches so far and its end. One Enter
// sends one `search`; its replies arrive on its id in order (searchParsed, nameMatches batches, then
// searchDone or cancelled). A newer search replaces the running one: the engine ends the old one
// with `cancelled`, and anything still arriving for it is ignored here. `cancel()` (Esc) asks the
// engine to stop the running search by its id: it stays running until the terminal reply, and a
// `cancelled` one keeps the matches so far and marks the search stopped. Closing the view cancels a
// running search too, and drops anything still arriving for it. It holds no product rules: the
// engine matches and decides (its `outcomeCode` and `notices`); the result list renders.
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
  /** The latest search ended `cancelled` (Esc stopped it): its matches so far stay, with no outcome. */
  stopped: boolean;
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
  /**
   * Stops the running search: sends `cancel` for it once, and keeps it running until its terminal
   * reply. Nothing while no search runs.
   */
  cancel(): void;
  /**
   * Closes the search view: back to the snapshot before any search. A running search is cancelled
   * first, and its late replies are dropped.
   */
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
  stopped: false,
  error: null,
};

/** Sees each reply of a search and each cancel sent, for the dev console. Never given the search text. */
export type SearchTrace = (id: string | null, type: string, detail?: Record<string, unknown>) => void;

export class SearchSession implements SearchActions {
  private current: SearchSnapshot = INITIAL_SEARCH;
  private readonly listeners = new Set<(snapshot: SearchSnapshot) => void>();
  private active = true;
  /** Counts searches, so only the newest one's replies are kept. */
  private latest = 0;
  /** The running latest search's request id, until its `cancel` is sent or it ends. */
  private cancellable: string | null = null;

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
    // A running search needs no cancel: the engine's search channel is latest-wins, so this one
    // replaces it and the old one ends `cancelled`, which is ignored below.
    const search = ++this.latest;
    this.cancellable = null;
    this.update({ open: true, root: place, running: true, parsed: null, matches: [], done: null, stopped: false, error: null });
    this.client
      .stream(
        { type: "search", text, folder: place.path },
        (message) => {
          this.traced(message);
          if (search !== this.latest) return; // a newer search owns the results
          if (message.type === "searchParsed") this.update({ parsed: message });
          else this.update({ matches: [...this.current.matches, ...message.matches] });
        },
        (id) => {
          if (search === this.latest) this.cancellable = id;
        },
      )
      .then((reply) => {
        this.traced(reply);
        if (search !== this.latest) return;
        this.cancellable = null;
        if (reply.type === "searchDone") this.update({ running: false, done: reply });
        else if (reply.type === "error") this.update({ running: false, error: reply.code });
        else this.update({ running: false, stopped: true }); // cancelled: the matches so far stay
      })
      .catch((err: unknown) => {
        if (search !== this.latest) return;
        // A restart ended the search: nothing more will arrive for it.
        this.cancellable = null;
        this.update({ running: false });
        if (!(err instanceof EngineStoppedError)) console.error("search request failed", err);
      });
  }

  cancel(): void {
    if (!this.current.running || this.cancellable === null) return;
    const id = this.cancellable;
    this.cancellable = null; // once: a second Esc before the reply sends nothing more
    this.trace?.(id, "cancel");
    this.client.cancel(id);
  }

  close(): void {
    // A running search is stopped; whatever still arrives for it is dropped.
    this.cancel();
    ++this.latest;
    this.cancellable = null;
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
