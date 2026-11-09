import { describe, expect, it, vi } from "vitest";
import { ProtocolClient, type EngineState, type Transport } from "../protocol/client";
import { BrowseSession, type BrowseSnapshot } from "./session";

const READY = '{"id":null,"type":"ready","protocolVersion":1}';
const DOCS = "C:\\Users\\dana\\Documents";

function listing(id: string, names: string[] = ["a.txt"]) {
  return JSON.stringify({
    id,
    type: "folderListing",
    path: DOCS,
    entries: names.map((name) => ({ name, kind: "file", typeCode: "text", size: 1, modified: null })),
  });
}

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

describe("BrowseSession", () => {
  it("lists Documents after ready and keeps the listing", async () => {
    const shell = fakeShell();
    const { session } = await started(shell);
    expect(session.snapshot).toEqual({ listing: null, error: null, loading: false });

    shell.engineReady();
    expect(shell.sent).toEqual([{ id: "u1", type: "listFolder" }]);
    expect(session.snapshot.loading).toBe(true);

    shell.line(listing("u1", ["סיכום ישיבה 3.docx"]));
    await flush();
    expect(session.snapshot.loading).toBe(false);
    expect(session.snapshot.error).toBeNull();
    expect(session.snapshot.listing?.path).toBe(DOCS);
    expect(session.snapshot.listing?.entries.map((e) => e.name)).toEqual(["סיכום ישיבה 3.docx"]);
  });

  it("lists for a ready that arrived before the page loaded", async () => {
    const shell = fakeShell(READY);
    await started(shell);
    expect(shell.sent).toEqual([{ id: "u1", type: "listFolder" }]);
  });

  it("keeps the last listing through a restart and lists again after the next ready", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const shell = fakeShell();
    const { session } = await started(shell);
    shell.engineReady();
    shell.line(listing("u1"));
    await flush();
    const first = session.snapshot.listing;

    // The engine dies mid-listing: the request ends silently, the old listing stays.
    session.list();
    shell.state("restarting");
    await flush();
    expect(session.snapshot).toEqual({ listing: first, error: null, loading: false });
    expect(errors).not.toHaveBeenCalled();

    shell.engineReady();
    expect(shell.sent.at(-1)).toEqual({ id: "u3", type: "listFolder" });
    expect(session.snapshot.listing).toBe(first);
    shell.line(listing("u3", ["b.txt"]));
    await flush();
    expect(session.snapshot.listing?.entries.map((e) => e.name)).toEqual(["b.txt"]);
    errors.mockRestore();
  });

  it("ignores cancelled and the replies of replaced requests", async () => {
    const shell = fakeShell();
    const { session } = await started(shell);
    shell.engineReady(); // u1
    session.list("D:\\Volunteering"); // u2 replaces u1
    expect(shell.sent.at(-1)).toEqual({ id: "u2", type: "listFolder", path: "D:\\Volunteering" });

    shell.line('{"id":"u1","type":"cancelled"}');
    await flush();
    expect(session.snapshot).toEqual({ listing: null, error: null, loading: true });

    shell.line(listing("u2"));
    await flush();
    expect(session.snapshot.listing?.id).toBe("u2");

    // A late reply for an older request never replaces the newer listing.
    session.list(); // u3
    session.list(); // u4
    shell.line(listing("u4", ["newest.txt"]));
    shell.line(listing("u3", ["older.txt"]));
    await flush();
    expect(session.snapshot.listing?.entries.map((e) => e.name)).toEqual(["newest.txt"]);
  });

  it("keeps the error code and clears it with the next listing", async () => {
    const shell = fakeShell();
    const { session } = await started(shell);
    shell.engineReady();
    shell.line('{"id":"u1","type":"error","code":"accessDenied","data":{}}');
    await flush();
    expect(session.snapshot).toEqual({ listing: null, error: "accessDenied", loading: false });

    session.list();
    shell.line(listing("u2"));
    await flush();
    expect(session.snapshot.error).toBeNull();
    expect(session.snapshot.listing?.id).toBe("u2");
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
