import { describe, expect, it } from "vitest";
import { catalog } from "../i18n/catalog";
import { ProtocolClient, type EngineState, type Transport } from "../protocol/client";
import { EngineSession, type EngineSnapshot } from "./session";

const READY = '{"id":null,"type":"ready","protocolVersion":1}';

/** A shell stand-in: records sent lines, lets the test push lines and state changes. */
function fakeShell(initialState: EngineState = "starting", cachedReady: string | null = null) {
  const sent: { id: string; type: string }[] = [];
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
    currentState: async () => initialState,
  };
  return {
    transport,
    sent,
    line: (l: string) => onLine(l),
    state: (s: EngineState) => onState(s),
    /** Shell order on (re)start: state `running`, then the engine's `ready` line. */
    engineReady: () => {
      onState("running");
      onLine(READY);
    },
  };
}

async function started(shell: ReturnType<typeof fakeShell>) {
  let n = 0;
  const client = new ProtocolClient(shell.transport, () => `u${++n}`);
  const session = new EngineSession(client);
  const seen: EngineSnapshot[] = [];
  session.subscribe((s) => seen.push(s));
  await session.start();
  return { client, session, seen };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("EngineSession", () => {
  it("shows the banner while restarting or stopped and hides it after ready", async () => {
    const shell = fakeShell();
    const { session } = await started(shell);
    expect(session.snapshot.bannerVisible).toBe(false);
    shell.engineReady();
    expect(session.snapshot).toMatchObject({ state: "running", protocolVersion: 1, bannerVisible: false });

    shell.state("restarting");
    expect(session.snapshot).toMatchObject({ state: "restarting", protocolVersion: null, bannerVisible: true });
    shell.engineReady();
    expect(session.snapshot).toMatchObject({ state: "running", protocolVersion: 1, bannerVisible: false });

    shell.state("restarting");
    shell.state("stopped");
    expect(session.snapshot).toMatchObject({ state: "stopped", bannerVisible: true });
  });

  it("shows the banner for a page that loads while the engine is restarting", async () => {
    const shell = fakeShell("restarting");
    const { session } = await started(shell);
    expect(session.snapshot).toMatchObject({ state: "restarting", bannerVisible: true });
  });

  it("sends status after every ready and keeps the report", async () => {
    const shell = fakeShell();
    const { session } = await started(shell);
    shell.engineReady();
    expect(shell.sent).toEqual([{ id: "u1", type: "status" }]);
    shell.line('{"id":"u1","type":"statusReport","phase":"idle","documentCount":0}');
    await flush();
    expect(session.snapshot.status).toEqual({ id: "u1", type: "statusReport", phase: "idle", documentCount: 0 });

    shell.state("restarting");
    expect(session.snapshot.status).toBeNull();
    shell.engineReady();
    expect(shell.sent).toEqual([
      { id: "u1", type: "status" },
      { id: "u2", type: "status" },
    ]);
  });

  it("sends status for a cached ready on a late page load", async () => {
    const shell = fakeShell("running", READY);
    const { session } = await started(shell);
    expect(session.snapshot).toMatchObject({ state: "running", protocolVersion: 1, bannerVisible: false });
    expect(shell.sent).toEqual([{ id: "u1", type: "status" }]);
  });

  it("ends a pending status request on restart without failing", async () => {
    const shell = fakeShell();
    const { session } = await started(shell);
    shell.engineReady();
    shell.state("restarting");
    await flush();
    // The reply of the killed engine is ignored; the snapshot stays without a status.
    shell.line('{"id":"u1","type":"statusReport","phase":"idle","documentCount":0}');
    await flush();
    expect(session.snapshot).toMatchObject({ state: "restarting", status: null, bannerVisible: true });
  });

  it("stops notifying after stop", async () => {
    const shell = fakeShell();
    const { session, seen } = await started(shell);
    session.stop();
    const before = seen.length;
    shell.engineReady();
    expect(seen.length).toBe(before);
  });
});

describe("catalog", () => {
  it("has the engine banner sentence", () => {
    expect(catalog["engine.restarting"]).toBe("The search stopped working. Trying again…");
  });

  it.each(Object.entries(catalog))("%s is plain text", (key, raw) => {
    expect(key).toMatch(/^[a-z][a-zA-Z0-9]*\.[a-z][a-zA-Z0-9]*$/); // context.code
    // `{name}` placeholders are filled by t(); the words around them are what the user reads.
    const value = raw.replace(/\{[a-z]+\}/g, "");
    expect(value.trim()).not.toBe("");
    expect(value).not.toMatch(/[{}<>[\]`$\\|_=]/); // no placeholders, markup or code punctuation
    expect(value).not.toMatch(/\b[a-z]+[A-Z]\w*/); // no camelCase identifiers or codes
    expect(value).not.toMatch(/\w\.\w/); // no dotted names, versions or paths
    expect(value).not.toMatch(/\b(0x[0-9a-f]+|error|exception|errno|stack|null|undefined)\b/i);
  });
});
