import { afterEach, describe, expect, it, vi } from "vitest";
import { ProtocolClient, type EngineState, type Transport } from "../protocol/client";
import type { PreviewReady } from "../protocol/generated";
import {
  INITIAL_PREVIEW,
  PREVIEW_TIMEOUT_MS,
  PreviewSession,
  previewKey,
  type PreviewItem,
  type PreviewSnapshot,
} from "./session";

const DOCS = "C:\\Users\\dana\\Documents";

const fileItem = (name: string, size: number | null = 10): PreviewItem => ({
  kind: "file",
  path: `${DOCS}\\${name}`,
  name,
  typeCode: name.endsWith(".png") ? "image" : "text",
  size,
  modified: null,
});
const FOLDER_ITEM: PreviewItem = { kind: "folder", path: `${DOCS}\\Photos`, name: "Photos", modified: null };

function ready(id: string, name: string, text = name): PreviewReady {
  return {
    id,
    type: "previewReady",
    details: { name, path: `${DOCS}\\${name}`, typeCode: "text", size: 10, modified: null },
    thumbnail: { kind: "text", text },
  };
}

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
    line: (message: unknown) => onLine(JSON.stringify(message)),
    state: (s: EngineState) => onState(s),
  };
}

async function started() {
  const shell = fakeShell();
  let n = 0;
  const client = new ProtocolClient(shell.transport, () => `p${++n}`);
  const session = new PreviewSession(client);
  const seen: PreviewSnapshot[] = [];
  session.subscribe((s) => seen.push(s));
  await client.start();
  return { shell, session, seen };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("PreviewSession", () => {
  it("sends one preview for a selected file and shows its reply", async () => {
    const { shell, session } = await started();
    session.select(fileItem("notes.txt"));
    expect(shell.sent).toEqual([{ type: "preview", path: `${DOCS}\\notes.txt`, id: "p1" }]);
    expect(session.snapshot).toEqual({ path: `${DOCS}\\notes.txt`, reply: null, loading: true, failed: false });
    const reply = ready("p1", "notes.txt");
    shell.line(reply);
    await flush();
    expect(session.snapshot).toEqual({ path: `${DOCS}\\notes.txt`, reply, loading: false, failed: false });
  });

  it("sends nothing for a folder or no selection, and clears the panel (EARS-02)", async () => {
    const { shell, session } = await started();
    session.select(fileItem("notes.txt"));
    session.select(FOLDER_ITEM);
    expect(session.snapshot).toEqual(INITIAL_PREVIEW);
    session.select(null);
    expect(session.snapshot).toEqual(INITIAL_PREVIEW);
    expect(shell.sent.map((m) => m.type)).toEqual(["preview"]);
    // The file's late reply doesn't bring it back.
    shell.line(ready("p1", "notes.txt"));
    await flush();
    expect(session.snapshot).toEqual(INITIAL_PREVIEW);
  });

  it("shows only the last of 20 quick selections, whatever order the replies come in", async () => {
    const { shell, session, seen } = await started();
    for (let i = 0; i < 20; i++) session.select(fileItem(`f${i}.txt`));
    expect(shell.sent).toHaveLength(20);
    // The engine ends the replaced ones `cancelled`; a stale previewReady is dropped as well.
    shell.line(ready("p20", "f19.txt"));
    for (let i = 1; i < 19; i++) shell.line({ id: `p${i}`, type: "cancelled" });
    shell.line(ready("p19", "f18.txt"));
    await flush();
    expect(session.snapshot.path).toBe(`${DOCS}\\f19.txt`);
    expect(session.snapshot.reply?.details.name).toBe("f19.txt");
    expect(seen.filter((s) => s.reply !== null).map((s) => s.reply!.details.name)).toEqual(["f19.txt"]);
  });

  it("marks the preview failed on an engine error", async () => {
    const { shell, session } = await started();
    session.select(fileItem("notes.txt"));
    shell.line({ id: "p1", type: "error", code: "invalidRequest", data: {} });
    await flush();
    expect(session.snapshot).toEqual({ path: `${DOCS}\\notes.txt`, reply: null, loading: false, failed: true });
  });

  it("marks the preview failed when an engine restart ends the request", async () => {
    const { shell, session } = await started();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    session.select(fileItem("photo.png"));
    shell.state("restarting");
    await flush();
    expect(session.snapshot).toEqual({ path: `${DOCS}\\photo.png`, reply: null, loading: false, failed: true });
    expect(error).not.toHaveBeenCalled(); // an EngineStoppedError is expected, not logged
    error.mockRestore();
  });

  it("marks the latest preview failed if it ends cancelled with nothing newer", async () => {
    const { shell, session } = await started();
    session.select(fileItem("notes.txt"));
    shell.line({ id: "p1", type: "cancelled" });
    await flush();
    expect(session.snapshot.failed).toBe(true);
  });

  describe("timeout", () => {
    afterEach(() => vi.useRealTimers());

    it("marks a selection with no reply failed after the timeout, and drops a later reply", async () => {
      const { shell, session } = await started();
      vi.useFakeTimers();
      session.select(fileItem("stuck.txt"));
      vi.advanceTimersByTime(PREVIEW_TIMEOUT_MS - 1);
      expect(session.snapshot.loading).toBe(true);
      vi.advanceTimersByTime(1);
      expect(session.snapshot).toEqual({ path: `${DOCS}\\stuck.txt`, reply: null, loading: false, failed: true });
      shell.line(ready("p1", "stuck.txt"));
      await vi.runAllTimersAsync();
      expect(session.snapshot.failed).toBe(true);
      expect(session.snapshot.reply).toBeNull();
    });

    it("never fires once the reply has arrived", async () => {
      const { shell, session } = await started();
      vi.useFakeTimers();
      session.select(fileItem("notes.txt"));
      shell.line(ready("p1", "notes.txt"));
      await vi.advanceTimersByTimeAsync(0);
      expect(vi.getTimerCount()).toBe(0);
      vi.advanceTimersByTime(PREVIEW_TIMEOUT_MS * 2);
      expect(session.snapshot.reply?.details.name).toBe("notes.txt");
      expect(session.snapshot.failed).toBe(false);
    });

    it("restarts for each newer selection, and stops with a folder, no selection or stop", async () => {
      const { session } = await started();
      vi.useFakeTimers();
      session.select(fileItem("a.txt"));
      vi.advanceTimersByTime(PREVIEW_TIMEOUT_MS - 100);
      session.select(fileItem("b.txt"));
      expect(vi.getTimerCount()).toBe(1);
      vi.advanceTimersByTime(PREVIEW_TIMEOUT_MS - 100);
      expect(session.snapshot).toMatchObject({ path: `${DOCS}\\b.txt`, loading: true, failed: false });
      session.select(FOLDER_ITEM);
      expect(vi.getTimerCount()).toBe(0);
      session.select(fileItem("c.txt"));
      session.select(null);
      expect(vi.getTimerCount()).toBe(0);
      session.select(fileItem("d.txt"));
      session.stop();
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  it("stops telling listeners after stop", async () => {
    const { session, seen } = await started();
    session.stop();
    session.select(fileItem("notes.txt"));
    expect(seen).toEqual([]);
  });
});

describe("previewKey", () => {
  it("tells a folder, a file and a changed file apart, and nothing from nothing", () => {
    expect(previewKey(null)).toBeNull();
    expect(previewKey(FOLDER_ITEM)).not.toBe(previewKey({ ...fileItem("Photos"), path: FOLDER_ITEM.path }));
    expect(previewKey(fileItem("a.txt"))).toBe(previewKey(fileItem("a.txt")));
    expect(previewKey(fileItem("a.txt", 10))).not.toBe(previewKey(fileItem("a.txt", 11)));
  });
});
