import { describe, expect, it, vi } from "vitest";
import { ProtocolClient, type EngineState, type Transport } from "../protocol/client";
import { INITIAL_SEARCH, SearchSession, type SearchSnapshot } from "./session";

const DOCS = "C:\\Users\\dana\\Documents";

/** A shell stand-in: records sent requests, lets the test push lines and state changes. */
function fakeShell() {
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
    lastReady: async () => null,
    subscribeState: async (handler) => {
      onState = handler;
      return () => {};
    },
    currentState: async () => "running",
  };
  return {
    transport,
    sent,
    line: (message: object) => onLine(JSON.stringify(message)),
    state: (s: EngineState) => onState(s),
  };
}

const parsed = (id: string, residualText = "report") => ({ id, type: "searchParsed", mode: "normal", dateRange: null, residualText });
const file = (name: string) => ({ name, kind: "file", typeCode: "pdf", path: `${DOCS}\\${name}`, folder: DOCS, modified: null });
const batch = (id: string, names: string[]) => ({ id, type: "nameMatches", matches: names.map(file) });
const done = (id: string) => ({ id, type: "searchDone", notices: [], indexVersion: null, indexingActive: false });

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

async function started(trace?: ConstructorParameters<typeof SearchSession>[1]) {
  const shell = fakeShell();
  let n = 0;
  const client = new ProtocolClient(shell.transport, () => `q${++n}`);
  await client.start();
  const session = new SearchSession(client, trace);
  const seen: SearchSnapshot[] = [];
  session.subscribe((s) => seen.push(s));
  return { shell, session, seen };
}

describe("SearchSession", () => {
  it("sends one search and keeps its replies in order until searchDone", async () => {
    const { shell, session } = await started();
    expect(session.snapshot).toEqual(INITIAL_SEARCH);
    session.search("report", DOCS);
    expect(shell.sent).toEqual([{ type: "search", text: "report", folder: DOCS, id: "q1" }]);
    expect(session.snapshot).toEqual({ running: true, parsed: null, matches: [], done: null, error: null });

    shell.line(parsed("q1"));
    shell.line(batch("q1", ["report.pdf"]));
    shell.line(batch("q1", ["report-final.pdf", "reports.pdf"]));
    expect(session.snapshot.running).toBe(true);
    expect(session.snapshot.parsed).toEqual(parsed("q1"));
    expect(session.snapshot.matches.map((m) => m.name)).toEqual(["report.pdf", "report-final.pdf", "reports.pdf"]);

    shell.line(done("q1"));
    await flush();
    expect(session.snapshot.running).toBe(false);
    expect(session.snapshot.done).toEqual(done("q1"));
    expect(session.snapshot.matches).toHaveLength(3);
  });

  it("sends nothing for blank text", async () => {
    const { shell, session, seen } = await started();
    session.search("   ", DOCS);
    session.search("", DOCS);
    expect(shell.sent).toEqual([]);
    expect(seen).toEqual([]);
  });

  it("keeps only the latest search: a replaced one's late replies are ignored", async () => {
    const { shell, session } = await started();
    session.search("report", DOCS);
    shell.line(parsed("q1"));
    shell.line(batch("q1", ["old.pdf"]));
    session.search("photo", DOCS);
    expect(session.snapshot).toEqual({ running: true, parsed: null, matches: [], done: null, error: null });
    // The engine ends the first with cancelled; a reply racing it changes nothing either.
    shell.line(batch("q1", ["late.pdf"]));
    shell.line({ id: "q1", type: "cancelled" });
    await flush();
    expect(session.snapshot).toEqual({ running: true, parsed: null, matches: [], done: null, error: null });

    shell.line(parsed("q2", "photo"));
    shell.line(batch("q2", ["photo.pdf"]));
    shell.line(done("q2"));
    await flush();
    expect(session.snapshot.parsed?.residualText).toBe("photo");
    expect(session.snapshot.matches.map((m) => m.name)).toEqual(["photo.pdf"]);
    expect(session.snapshot.running).toBe(false);
  });

  it("keeps an error reply's code, with no results", async () => {
    const { shell, session } = await started();
    session.search("report", "C:\\gone");
    shell.line({ id: "q1", type: "error", code: "folderNotFound", data: {} });
    await flush();
    expect(session.snapshot).toEqual({ running: false, parsed: null, matches: [], done: null, error: "folderNotFound" });
    // A new search starts with no error.
    session.search("report", DOCS);
    expect(session.snapshot.error).toBeNull();
    // A cancel is not an error.
    shell.line({ id: "q2", type: "cancelled" });
    await flush();
    expect(session.snapshot).toEqual({ running: false, parsed: null, matches: [], done: null, error: null });
  });

  it("stops running when the engine restarts, without logging an error", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { shell, session } = await started();
      session.search("report", DOCS);
      shell.line(parsed("q1"));
      shell.state("restarting");
      await flush();
      expect(session.snapshot.running).toBe(false);
      expect(session.snapshot.done).toBeNull();
      expect(error).not.toHaveBeenCalled();
    } finally {
      error.mockRestore();
    }
  });

  it("traces each reply's id and type, never the search text", async () => {
    const trace = vi.fn();
    const { shell, session } = await started(trace);
    session.search("secret words", DOCS);
    shell.line(parsed("q1", "secret words"));
    shell.line(batch("q1", ["a.pdf", "b.pdf"]));
    shell.line(done("q1"));
    await flush();
    expect(trace.mock.calls).toEqual([
      ["q1", "searchParsed"],
      ["q1", "nameMatches", { matches: 2 }],
      ["q1", "searchDone"],
    ]);
    expect(JSON.stringify(trace.mock.calls)).not.toContain("secret");
  });

  it("stops notifying once stopped", async () => {
    const { shell, session, seen } = await started();
    session.search("report", DOCS);
    const count = seen.length;
    session.stop();
    shell.line(parsed("q1"));
    shell.line(done("q1"));
    await flush();
    expect(seen).toHaveLength(count);
  });
});
