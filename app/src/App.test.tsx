// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "@/i18n/catalog";
import type { EngineState, Transport } from "./protocol/client";
import App from "./App";

// A shell stand-in in place of the Tauri transport: the test pushes engine states and lines.
const shell = vi.hoisted(() => {
  const handlers = {
    line: (_line: string) => {},
    state: (_state: string) => {},
  };
  const sent: { id: string; type: string }[] = [];
  return { handlers, sent };
});

vi.mock("./protocol/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./protocol/client")>();
  const transport: Transport = {
    send: async (line) => {
      shell.sent.push(JSON.parse(line));
    },
    subscribe: async (onLine) => {
      shell.handlers.line = onLine;
      return () => {};
    },
    lastReady: async () => null,
    subscribeState: async (onState) => {
      shell.handlers.state = onState as (state: string) => void;
      return () => {};
    },
    currentState: async () => "starting" as EngineState,
  };
  return { ...actual, tauriTransport: () => transport };
});

// The dev readout logs to the console; keep test output quiet.
vi.spyOn(console, "info").mockImplementation(() => {});

afterEach(() => {
  cleanup();
  shell.sent.length = 0;
});

const flush = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

describe("App", () => {
  it("shows the engine banner from the session while the engine is down", async () => {
    render(<App />);
    await flush();
    expect(screen.queryByRole("alert")).toBeNull();

    act(() => shell.handlers.state("restarting"));
    expect(screen.getByRole("alert").textContent).toBe(t("engine.restarting"));

    act(() => {
      shell.handlers.state("running");
      shell.handlers.line('{"id":null,"type":"ready","protocolVersion":1}');
    });
    expect(screen.queryByRole("alert")).toBeNull();

    act(() => shell.handlers.state("stopped"));
    expect(screen.getByRole("alert").textContent).toBe(t("engine.restarting"));
  });

  it("shows the engine's folder listing in the main list", async () => {
    render(<App />);
    await flush();
    act(() => {
      shell.handlers.state("running");
      shell.handlers.line('{"id":null,"type":"ready","protocolVersion":1}');
    });
    const request = shell.sent.find((m) => m.type === "listFolder");
    expect(request).toBeDefined();
    const listing = {
      id: request!.id,
      type: "folderListing",
      path: "C:\\Users\\dana\\Documents",
      entries: [
        { name: "Photos", kind: "folder", modified: null },
        { name: "סיכום ישיבה 3.docx", kind: "file", typeCode: "word", size: 38912, modified: null },
      ],
    };
    act(() => shell.handlers.line(JSON.stringify(listing)));
    await flush();
    const main = within(screen.getByRole("main"));
    expect(main.getByText("Photos")).toBeTruthy();
    expect(main.getByText("סיכום ישיבה 3.docx")).toBeTruthy();
  });
});
