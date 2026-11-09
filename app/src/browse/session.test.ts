import { describe, expect, it, vi } from "vitest";
import { ProtocolClient, type EngineState, type Transport } from "../protocol/client";
import { BrowseSession, INITIAL_SNAPSHOT, childPath, type BrowseSnapshot } from "./session";

const READY = '{"id":null,"type":"ready","protocolVersion":1}';
const DOCS = "C:\\Users\\dana\\Documents";
const VOL = `${DOCS}\\Volunteering`;
const WORK = "D:\\Work";

/** A folderListing line for `path`; its parent is everything before the last backslash. */
function listing(id: string, path: string = DOCS, names: string[] = ["a.txt"]) {
  const cut = path.lastIndexOf("\\");
  const parent = path.endsWith("\\") ? null : cut <= 2 ? path.slice(0, 3) : path.slice(0, cut);
  return JSON.stringify({
    id,
    type: "folderListing",
    path,
    parent,
    segments: [{ kind: "folder", name: path, path }],
    entries: names.map((name) => ({ name, kind: "file", typeCode: "text", size: 1, modified: null })),
  });
}

const failure = (id: string, code: string) => JSON.stringify({ id, type: "error", code, data: {} });

/** A shell stand-in: records sent requests, lets the test push lines and state changes. */
function fakeShell(cachedReady: string | null = null) {
  const sent: Record<string, unknown>[] = [];
  let onLine: (line: string) => void = () => {};
  let onState: (state: EngineState) => void = () => {};
  const transport: Transport = {
    send: async (line) => {
      sent.push(JSON.parse(line));
    },
    subscribe: async (handler) => {
      onLine = handler;
      return () => {};
    },
    lastReady: async () => cachedReady,
    subscribeState: async (handler) => {
      onState = handler;
      return () => {};
    },
    currentState: async () => "starting",
  };
  return {
    transport,
    sent,
    line: (l: string) => onLine(l),
    state: (s: EngineState) => onState(s),
    engineReady: () => {
      onState("running");
      onLine(READY);
    },
    /** The id and path of the last listFolder request. */
    lastList: () => {
      const request = sent.filter((m) => m.type === "listFolder").at(-1)!;
      return { id: request.id as string, path: request.path as string | undefined };
    },
  };
}

async function started(shell: ReturnType<typeof fakeShell>) {
  let n = 0;
  const client = new ProtocolClient(shell.transport, () => `u${++n}`);
  const session = new BrowseSession(client);
  const seen: BrowseSnapshot[] = [];
  session.subscribe((s) => seen.push(s));
  await client.start();
  return { client, session, seen };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Starts a session that has listed Documents (request u1; u2 asked for the locations). */
async function inDocuments() {
  const shell = fakeShell();
  const result = await started(shell);
  shell.engineReady();
  shell.line(listing("u1"));
  await flush();
  return { shell, ...result };
}

/** Opens `path` and answers with its listing (normalized to `reply`, if given). */
async function openAndReply(
  shell: ReturnType<typeof fakeShell>,
  go: () => void,
  reply?: string,
): Promise<void> {
  go();
  const { id, path } = shell.lastList();
  shell.line(listing(id, reply ?? path));
  await flush();
}

describe("BrowseSession", () => {
  it("lists Documents and asks for the locations after ready", async () => {
    const shell = fakeShell();
    const { session } = await started(shell);
    expect(session.snapshot).toEqual(INITIAL_SNAPSHOT);

    shell.engineReady();
    expect(shell.sent).toEqual([
      { id: "u1", type: "listFolder" },
      { id: "u2", type: "listLocations" },
    ]);
    expect(session.snapshot.loading).toBe(true);

    shell.line(listing("u1", DOCS, ["סיכום ישיבה 3.docx"]));
    const locations = { id: "u2", type: "locations", knownFolders: [{ code: "documents", path: DOCS }], drives: [] };
    shell.line(JSON.stringify(locations));
    await flush();
    expect(session.snapshot).toMatchObject({
      location: DOCS,
      error: null,
      loading: false,
      canBack: false,
      canForward: false,
      pathError: null,
      locations,
    });
    expect(session.snapshot.listing?.entries.map((e) => e.name)).toEqual(["סיכום ישיבה 3.docx"]);
  });

  it("lists for a ready that arrived before the page loaded", async () => {
    const shell = fakeShell(READY);
    await started(shell);
    expect(shell.sent).toEqual([
      { id: "u1", type: "listFolder" },
      { id: "u2", type: "listLocations" },
    ]);
  });

  it("pushes opened folders on history and moves back and forward through them", async () => {
    const { shell, session } = await inDocuments();
    await openAndReply(shell, () => session.open(VOL));
    expect(shell.lastList().path).toBe(VOL);
    expect(session.snapshot).toMatchObject({ location: VOL, canBack: true, canForward: false });

    await openAndReply(shell, () => session.open(WORK));
    await openAndReply(shell, () => session.back());
    expect(shell.lastList().path).toBe(VOL);
    expect(session.snapshot).toMatchObject({ location: VOL, canBack: true, canForward: true });

    await openAndReply(shell, () => session.back());
    expect(shell.lastList().path).toBe(DOCS);
    expect(session.snapshot).toMatchObject({ location: DOCS, canBack: false, canForward: true });

    await openAndReply(shell, () => session.forward());
    await openAndReply(shell, () => session.forward());
    expect(shell.lastList().path).toBe(WORK);
    expect(session.snapshot).toMatchObject({ location: WORK, canBack: true, canForward: false });

    // Opening a folder from the middle of history clears Forward.
    await openAndReply(shell, () => session.back());
    await openAndReply(shell, () => session.open("E:\\"));
    expect(session.snapshot).toMatchObject({ location: "E:\\", canBack: true, canForward: false });
    await openAndReply(shell, () => session.back());
    expect(session.snapshot.location).toBe(VOL);
  });

  it("keeps the engine's normalized path in history, and opening the current folder pushes nothing", async () => {
    const { shell, session } = await inDocuments();
    await openAndReply(shell, () => session.open("c:\\users\\dana\\documents\\volunteering\\"), VOL);
    expect(session.snapshot.location).toBe(VOL);
    await openAndReply(shell, () => session.open(VOL));
    await openAndReply(shell, () => session.back());
    expect(shell.lastList().path).toBe(DOCS);
    expect(session.snapshot.canBack).toBe(false);
    await openAndReply(shell, () => session.forward());
    expect(shell.lastList().path).toBe(VOL);
  });

  it("does nothing for Back, Forward or Up when there's nowhere to go", async () => {
    const { shell, session } = await inDocuments();
    await openAndReply(shell, () => session.open("D:\\"));
    expect(session.snapshot.place?.parent).toBeNull();
    const count = shell.sent.length;
    session.forward();
    session.up();
    expect(shell.sent.length).toBe(count);
    session.back();
    expect(shell.sent.length).toBe(count + 1);
  });

  it("goes Up to the listing's parent and pushes it on history", async () => {
    const { shell, session } = await inDocuments();
    await openAndReply(shell, () => session.open(VOL));
    await openAndReply(shell, () => session.up());
    expect(shell.lastList().path).toBe(DOCS);
    expect(session.snapshot).toMatchObject({ location: DOCS, canBack: true, canForward: false });
    await openAndReply(shell, () => session.back());
    expect(session.snapshot.location).toBe(VOL);
  });

  it("keeps the current folder and history when a typed path fails", async () => {
    const { shell, session } = await inDocuments();
    await openAndReply(shell, () => session.open(VOL));
    const shown = session.snapshot.listing;

    session.openTyped("C:\\nope");
    shell.line(failure(shell.lastList().id, "folderNotFound"));
    await flush();
    expect(session.snapshot).toMatchObject({
      listing: shown,
      location: VOL,
      error: null,
      loading: false,
      pathError: "folderNotFound",
      canBack: true,
      canForward: false,
    });

    session.clearPathError();
    expect(session.snapshot.pathError).toBeNull();

    session.openTyped("relative");
    shell.line(failure(shell.lastList().id, "folderUnavailable"));
    await flush();
    expect(session.snapshot.pathError).toBe("folderUnavailable");

    // A typed path that opens clears the error and is pushed like any other folder.
    await openAndReply(shell, () => session.openTyped("  \"d:\\work\"  "), WORK);
    expect(session.snapshot).toMatchObject({ location: WORK, pathError: null, canBack: true });
    await openAndReply(shell, () => session.back());
    expect(session.snapshot.location).toBe(VOL);
  });

  it("shows a folder that fails to open as the location in the empty state, and Back still works", async () => {
    const { shell, session } = await inDocuments();
    session.open(`${DOCS}\\Private`);
    shell.line(failure(shell.lastList().id, "accessDenied"));
    await flush();
    expect(session.snapshot).toMatchObject({
      listing: null,
      location: `${DOCS}\\Private`,
      error: "accessDenied",
      pathError: null,
      canBack: true,
    });
    await openAndReply(shell, () => session.back());
    expect(session.snapshot).toMatchObject({ location: DOCS, error: null, canForward: true });
    await openAndReply(shell, () => session.forward(), `${DOCS}\\Private`);
    expect(shell.lastList().path).toBe(`${DOCS}\\Private`);
  });

  it("keeps the place of a folder that exists but can't be listed, so Up works from it", async () => {
    const { shell, session } = await inDocuments();
    const privatePath = `${DOCS}\\Private`;
    const place = {
      path: privatePath,
      parent: DOCS,
      segments: [
        { kind: "knownFolder", code: "documents", path: DOCS },
        { kind: "folder", name: "Private", path: privatePath },
      ],
    };
    // Opened as "private"; the engine's normalized path goes into history.
    session.open(`${DOCS}\\private`);
    shell.line(JSON.stringify({ id: shell.lastList().id, type: "error", code: "accessDenied", data: place }));
    await flush();
    expect(session.snapshot).toMatchObject({ listing: null, place, location: privatePath, error: "accessDenied" });

    await openAndReply(shell, () => session.up());
    expect(shell.lastList().path).toBe(DOCS);
    await openAndReply(shell, () => session.back(), privatePath);
    expect(shell.lastList().path).toBe(privatePath);
  });

  it("drops a malformed place and logs a locations error", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const shell = fakeShell();
    const { session } = await started(shell);
    shell.engineReady();
    const locationsId = shell.sent.find((m) => m.type === "listLocations")!.id as string;
    shell.line(JSON.stringify({ id: locationsId, type: "error", code: "invalidRequest", data: {} }));
    shell.line(JSON.stringify({ id: shell.lastList().id, type: "error", code: "accessDenied", data: { path: 1 } }));
    await flush();
    expect(errors).toHaveBeenCalledWith("listLocations failed", "invalidRequest");
    expect(session.snapshot).toMatchObject({ place: null, locations: null, error: "accessDenied" });
    errors.mockRestore();
  });

  it("lists the current folder again after a restart and keeps the history", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { shell, session } = await inDocuments();
    await openAndReply(shell, () => session.open(WORK));
    const shown = session.snapshot.listing;

    // The engine dies mid-navigation: the request ends silently, the folder and history stay.
    session.open(`${WORK}\\2025`);
    shell.state("restarting");
    await flush();
    expect(session.snapshot).toMatchObject({ listing: shown, location: WORK, loading: false, canBack: true });
    expect(errors).not.toHaveBeenCalled();

    shell.engineReady();
    const relist = shell.sent.slice(-2);
    expect(relist).toEqual([
      { id: relist[0].id, type: "listFolder", path: WORK },
      { id: relist[1].id, type: "listLocations" },
    ]);
    shell.line(listing(relist[0].id as string, WORK, ["b.txt"]));
    await flush();
    expect(session.snapshot.listing?.entries.map((e) => e.name)).toEqual(["b.txt"]);
    expect(session.snapshot).toMatchObject({ location: WORK, canBack: true, canForward: false });
    await openAndReply(shell, () => session.back());
    expect(session.snapshot.location).toBe(DOCS);
    errors.mockRestore();
  });

  it("ignores cancelled and the replies of replaced requests", async () => {
    const shell = fakeShell();
    const { session } = await started(shell);
    shell.engineReady(); // u1 (u2: locations)
    session.open("D:\\Volunteering"); // u3 replaces u1
    expect(shell.sent.at(-1)).toEqual({ id: "u3", type: "listFolder", path: "D:\\Volunteering" });

    shell.line('{"id":"u1","type":"cancelled"}');
    await flush();
    expect(session.snapshot).toMatchObject({ listing: null, error: null, loading: true });

    shell.line(listing("u3", "D:\\Volunteering"));
    await flush();
    expect(session.snapshot.listing?.id).toBe("u3");

    // A late reply for an older request never replaces the newer listing or touches history.
    session.open(WORK); // u4
    session.open(VOL); // u5
    shell.line(listing("u5", VOL, ["newest.txt"]));
    shell.line(listing("u4", WORK, ["older.txt"]));
    await flush();
    expect(session.snapshot.listing?.entries.map((e) => e.name)).toEqual(["newest.txt"]);
    await openAndReply(shell, () => session.back());
    expect(shell.lastList().path).toBe("D:\\Volunteering");
  });

  it("keeps the error code and clears it with the next listing", async () => {
    const shell = fakeShell();
    const { session } = await started(shell);
    shell.engineReady();
    shell.line(failure("u1", "accessDenied"));
    await flush();
    expect(session.snapshot).toMatchObject({ listing: null, location: null, error: "accessDenied", loading: false });

    session.reload();
    shell.line(listing(shell.lastList().id));
    await flush();
    expect(session.snapshot.error).toBeNull();
    expect(session.snapshot.location).toBe(DOCS);
  });

  it("stops notifying after stop", async () => {
    const shell = fakeShell();
    const { session, seen } = await started(shell);
    session.stop();
    shell.engineReady();
    await flush();
    expect(seen).toEqual([]);
    expect(shell.sent).toEqual([]);
  });
});

describe("childPath", () => {
  it("joins a listed folder and a child name", () => {
    expect(childPath(DOCS, "Volunteering")).toBe(VOL);
    expect(childPath("C:\\", "Users")).toBe("C:\\Users");
    expect(childPath("\\\\server\\share\\", "Team")).toBe("\\\\server\\share\\Team");
  });
});
