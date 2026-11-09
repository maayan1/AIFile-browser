// The navigation model, kept outside React so it can be tested: the folder on screen, Back and
// Forward history, the typed-path error and the nav pane's locations. After every `ready` it
// lists the current folder again (Documents at first) and asks for the locations. It holds no
// product rules: the engine normalizes paths, filters and types the entries and splits the
// breadcrumb; the catalog words them. The UI only joins a listed folder's path with a child name.
// Opening a file goes to the shell instead (the default app); it changes nothing here.
import type { FolderListing, Locations } from "../protocol/generated";
import { EngineStoppedError, type ProtocolClient, type Request } from "../protocol/client";
import { openFile as shellOpenFile } from "../shell/open";

/** Where a folder is, as the engine describes it: its path, its parent and its breadcrumb. */
export type Place = Pick<FolderListing, "path" | "parent" | "segments">;

export interface BrowseSnapshot {
  /**
   * The last folder listing; kept while a newer one loads and while the engine restarts. After
   * Show in folder its `selected` names the item to select.
   */
  listing: FolderListing | null;
  /**
   * The current folder's place: from its listing, or from the error of a folder that exists but
   * can't be listed, so Up and the breadcrumb still work there. Null when the engine sent none.
   */
  place: Place | null;
  /**
   * Where the user is: the listed folder's normalized path, or the path that failed to open (shown
   * in the empty state). Null until the first folder replies.
   */
  location: string | null;
  /** The engine's error code for the current location (e.g. `accessDenied`); null after a listing. */
  error: string | null;
  /** A listing request is waiting for its reply. */
  loading: boolean;
  canBack: boolean;
  canForward: boolean;
  /** The error code for the last typed path; the current folder stays open. */
  pathError: string | null;
  /** The nav pane's known folders and drives; null until the engine sends them. */
  locations: Locations | null;
}

/** What the views may ask the session to do. */
export interface BrowseActions {
  /** Opens a folder from a row, Up, a breadcrumb segment or the nav pane. */
  open(path: string): void;
  /** Opens a typed or pasted path; a failure only sets `pathError`. */
  openTyped(path: string): void;
  /** Opens a file in its Windows default app; the list stays as it is. */
  openFile(path: string): void;
  /** Lists the folder that holds `path` (a file or folder) with that item selected. */
  showInFolder(path: string): void;
  back(): void;
  forward(): void;
  up(): void;
  clearPathError(): void;
}

/** A child of a listed folder: the one path the UI builds itself (the engine normalizes it). */
export function childPath(folder: string, name: string): string {
  return folder.endsWith("\\") ? folder + name : `${folder}\\${name}`;
}

/** The snapshot before anything is listed. */
export const INITIAL_SNAPSHOT: BrowseSnapshot = {
  listing: null,
  place: null,
  location: null,
  error: null,
  loading: false,
  canBack: false,
  canForward: false,
  pathError: null,
  locations: null,
};

/** The place a folder error's data carries, when the folder exists (see error.schema.json). */
function placeOf(data: Record<string, unknown>): Place | null {
  const { path, parent, segments } = data;
  if (typeof path !== "string" || !(typeof parent === "string" || parent === null)) return null;
  if (!Array.isArray(segments) || segments.length === 0) return null;
  return { path, parent, segments: segments as Place["segments"] };
}

/** How a reply moves through history once it arrives. */
type Move = "push" | "back" | "forward" | "stay";

/** The requests whose reply is a folder listing (both on the engine's listFolder channel). */
type FolderRequest = Extract<Request, { type: "listFolder" | "showInFolder" }>;

const listFolder = (path: string): FolderRequest => ({ type: "listFolder", path });

export class BrowseSession implements BrowseActions {
  private current: BrowseSnapshot = INITIAL_SNAPSHOT;
  private readonly listeners = new Set<(snapshot: BrowseSnapshot) => void>();
  private readonly unsubscribe: () => void;
  private active = true;
  /** Counts list requests, so only the newest one's reply is shown. */
  private latest = 0;
  private location: string | null = null;
  private backStack: string[] = [];
  private forwardStack: string[] = [];

  constructor(
    private readonly client: ProtocolClient,
    private readonly opener: (path: string) => Promise<void> = shellOpenFile,
  ) {
    this.unsubscribe = client.onEvent((event) => {
      if (event.type !== "ready") return;
      this.reload();
      this.requestLocations();
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

  /** Lists the current folder again (Documents before the first one), keeping history. */
  reload(): void {
    this.go(this.location === null ? { type: "listFolder" } : listFolder(this.location), "stay");
  }

  open(path: string): void {
    this.go(listFolder(path), "push");
  }

  openTyped(path: string): void {
    this.go(listFolder(path), "push", true);
  }

  openFile(path: string): void {
    // Windows shows its own dialog when the file can't be opened; the shell logs it.
    this.opener(path).catch((err: unknown) => console.error("openFile failed", err));
  }

  showInFolder(path: string): void {
    this.go({ type: "showInFolder", path }, "push");
  }

  back(): void {
    const target = this.backStack.at(-1);
    if (target !== undefined) this.go(listFolder(target), "back");
  }

  forward(): void {
    const target = this.forwardStack.at(-1);
    if (target !== undefined) this.go(listFolder(target), "forward");
  }

  up(): void {
    const parent = this.current.place?.parent;
    if (parent) this.go(listFolder(parent), "push");
  }

  clearPathError(): void {
    if (this.current.pathError !== null) this.update({ pathError: null });
  }

  stop(): void {
    this.active = false;
    this.unsubscribe();
    this.listeners.clear();
  }

  /**
   * Sends a listing request (`listFolder`, or `showInFolder`, whose reply names the item to
   * select). History changes only when the reply arrives, so a request that a newer one replaced,
   * or that a restart ended, leaves it as it was.
   */
  private go(message: FolderRequest, move: Move, typed = false): void {
    const request = ++this.latest;
    const path = message.path;
    this.update(move === "stay" ? { loading: true } : { loading: true, pathError: null });
    this.client
      .request(message)
      .then((reply) => {
        if (request !== this.latest) return; // a newer request owns the list
        if (reply.type === "folderListing") {
          this.commit(move, reply.path);
          const place = { path: reply.path, parent: reply.parent, segments: reply.segments };
          this.update({ listing: reply, place, location: reply.path, error: null, loading: false });
        } else if (reply.type === "error") {
          if (typed) {
            this.update({ loading: false, pathError: reply.code });
            return;
          }
          // The folder that failed becomes the location, shown in the empty state; Back works,
          // and when the folder exists its place keeps Up and the breadcrumb working too. A
          // showInFolder path names an item, not a folder: without a place it stays where it is.
          const place = placeOf(reply.data);
          const where = place?.path ?? (message.type === "showInFolder" ? (this.location ?? undefined) : path);
          if (where !== undefined) this.commit(move, where);
          this.update({ listing: null, place, location: this.location, error: reply.code, loading: false });
        }
        // `cancelled`: a newer request replaced this one, and its reply is on the way.
      })
      .catch((err: unknown) => {
        if (request !== this.latest) return;
        // A restart ended the request: keep what is on screen, the next `ready` lists again.
        this.update({ loading: false });
        if (!(err instanceof EngineStoppedError)) console.error(`${message.type} request failed`, err);
      });
  }

  private commit(move: Move, location: string): void {
    const from = this.location;
    if (move === "push" && from !== null && from !== location) {
      this.backStack.push(from);
      this.forwardStack = [];
    } else if (move === "back") {
      this.backStack.pop();
      if (from !== null) this.forwardStack.push(from);
    } else if (move === "forward") {
      this.forwardStack.pop();
      if (from !== null) this.backStack.push(from);
    }
    this.location = location;
  }

  private requestLocations(): void {
    this.client
      .request({ type: "listLocations" })
      .then((reply) => {
        if (reply.type === "locations") this.update({ locations: reply });
        else if (reply.type === "error") console.error("listLocations failed", reply.code);
      })
      .catch((err: unknown) => {
        // A restart ended the request; the next `ready` asks again.
        if (!(err instanceof EngineStoppedError)) console.error("listLocations request failed", err);
      });
  }

  private update(change: Partial<BrowseSnapshot>): void {
    if (!this.active) return;
    this.current = {
      ...this.current,
      ...change,
      canBack: this.backStack.length > 0,
      canForward: this.forwardStack.length > 0,
    };
    for (const listener of this.listeners) listener(this.current);
  }
}
