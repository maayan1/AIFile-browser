// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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
  const sent: { id: string; type: string; path?: string }[] = [];
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
    await readyApp();
    const request = lastRequest("listFolder");
    expect(request.path).toBeUndefined();
    reply(listingOf(request.id, DOCS, [{ kind: "knownFolder", code: "documents", path: DOCS }]));
    await flush();
    const main = within(screen.getByRole("main"));
    expect(main.getByText("Photos")).toBeTruthy();
    expect(main.getByText("סיכום ישיבה 3.docx")).toBeTruthy();
  });

  it("wires rows, Back/Forward/Up, the breadcrumb and the nav pane to the browse session", async () => {
    await readyApp();
    reply(listingOf(lastRequest("listFolder").id, DOCS, [{ kind: "knownFolder", code: "documents", path: DOCS }]));
    reply({
      id: lastRequest("listLocations").id,
      type: "locations",
      knownFolders: [{ code: "documents", path: DOCS }],
      drives: [{ letter: "C", label: null, path: "C:\\" }],
    });
    await flush();
    const button = (name: string) => screen.getByRole<HTMLButtonElement>("button", { name });
    expect(button(t("topBar.back")).disabled).toBe(true);
    expect(button(t("topBar.up")).disabled).toBe(false);
    const nav = within(screen.getByRole("navigation", { name: t("nav.label") }));
    expect(nav.getByRole("button", { name: "Documents" }).getAttribute("aria-current")).toBe("location");

    // Double-click a folder row: the engine is asked for its path.
    act(() => fireEvent.doubleClick(within(screen.getByRole("main")).getByText("Photos")));
    const photos = `${DOCS}\\Photos`;
    expect(lastRequest("listFolder").path).toBe(photos);
    reply(
      listingOf(lastRequest("listFolder").id, photos, [
        { kind: "knownFolder", code: "documents", path: DOCS },
        { kind: "folder", name: "Photos", path: photos },
      ]),
    );
    await flush();
    expect(button(t("topBar.back")).disabled).toBe(false);
    expect(button(t("topBar.forward")).disabled).toBe(true);

    // Back, then Forward.
    act(() => fireEvent.click(button(t("topBar.back"))));
    expect(lastRequest("listFolder").path).toBe(DOCS);
    reply(listingOf(lastRequest("listFolder").id, DOCS, [{ kind: "knownFolder", code: "documents", path: DOCS }]));
    await flush();
    expect(button(t("topBar.forward")).disabled).toBe(false);

    // A breadcrumb segment, the nav pane and Up each open their folder.
    act(() => fireEvent.click(nav.getByRole("button", { name: "Local Disk (C:)" })));
    expect(lastRequest("listFolder").path).toBe("C:\\");
    act(() => fireEvent.click(button(t("topBar.up"))));
    expect(lastRequest("listFolder").path).toBe("C:\\Users\\dana");
    const crumbs = within(screen.getByRole("group", { name: t("breadcrumb.label") }));
    act(() => fireEvent.click(crumbs.getByRole("button", { name: "Documents" })));
    expect(lastRequest("listFolder").path).toBe(DOCS);

    // Alt+D, a typed path and Enter.
    act(() => fireEvent.keyDown(window, { key: "d", code: "KeyD", altKey: true }));
    const field = screen.getByRole("textbox", { name: t("breadcrumb.field") });
    act(() => fireEvent.change(field, { target: { value: "C:\\nope" } }));
    act(() => fireEvent.keyDown(field, { key: "Enter" }));
    expect(lastRequest("listFolder").path).toBe("C:\\nope");
    reply({ id: lastRequest("listFolder").id, type: "error", code: "folderNotFound", data: {} });
    await flush();
    expect(screen.getByRole("alert").textContent).toBe("This folder doesn't exist.");
    expect(within(screen.getByRole("main")).getByText("Photos")).toBeTruthy(); // the folder stays
  });
});

const DOCS = "C:\\Users\\dana\\Documents";

async function readyApp() {
  render(<App />);
  await flush();
  act(() => {
    shell.handlers.state("running");
    shell.handlers.line('{"id":null,"type":"ready","protocolVersion":1}');
  });
}

function lastRequest(type: string): { id: string; type: string; path?: string } {
  const request = shell.sent.filter((m) => m.type === type).at(-1);
  expect(request, `no ${type} request`).toBeDefined();
  return request!;
}

function reply(message: object) {
  act(() => shell.handlers.line(JSON.stringify(message)));
}

function listingOf(id: string, path: string, segments: object[]) {
  const cut = path.lastIndexOf("\\");
  return {
    id,
    type: "folderListing",
    path,
    parent: cut <= 2 ? "C:\\" : path.slice(0, cut),
    segments,
    entries: [
      { name: "Photos", kind: "folder", modified: null },
      { name: "סיכום ישיבה 3.docx", kind: "file", typeCode: "word", size: 38912, modified: null },
    ],
  };
}
