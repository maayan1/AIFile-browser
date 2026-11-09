// Pins the UI side of the shell's IPC contract to protocol/ipc.json. The Rust side asserts the
// same file in engine.rs, so a rename on either side fails a test instead of the real app.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke, listen } = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen }));

import { ENGINE_MESSAGE_EVENT, ENGINE_STATE_EVENT, tauriTransport } from "./client";

interface Ipc {
  commands: { send: string; ready: string; state: string };
  sendArgument: string;
  events: { message: string; state: string };
}

// Loaded through Vite so the test needs no Node file APIs.
const ipc = Object.values(
  import.meta.glob<Ipc>("../../../protocol/ipc.json", { eager: true, import: "default" }),
)[0];

describe("tauriTransport", () => {
  beforeEach(() => {
    invoke.mockReset().mockResolvedValue(null);
    listen.mockReset().mockResolvedValue(() => {});
  });

  it("finds protocol/ipc.json", () => {
    expect(ipc).toBeDefined();
  });

  it("uses the event names the shell emits", () => {
    expect(ENGINE_MESSAGE_EVENT).toBe(ipc.events.message);
    expect(ENGINE_STATE_EVENT).toBe(ipc.events.state);
  });

  it("calls the shell's commands with their argument names", async () => {
    const transport = tauriTransport();
    await transport.send('{"id":"u1","type":"ping"}');
    await transport.lastReady();
    await transport.currentState();
    expect(invoke.mock.calls).toEqual([
      [ipc.commands.send, { [ipc.sendArgument]: '{"id":"u1","type":"ping"}' }],
      [ipc.commands.ready],
      [ipc.commands.state],
    ]);
  });

  it("listens on the shell's events and passes their payloads through", async () => {
    const lines: string[] = [];
    const states: string[] = [];
    const transport = tauriTransport();
    await transport.subscribe((line) => lines.push(line));
    await transport.subscribeState((state) => states.push(state));
    expect(listen.mock.calls.map(([name]) => name)).toEqual([ipc.events.message, ipc.events.state]);
    listen.mock.calls[0][1]({ payload: "a line" });
    listen.mock.calls[1][1]({ payload: "running" });
    expect(lines).toEqual(["a line"]);
    expect(states).toEqual(["running"]);
  });
});
