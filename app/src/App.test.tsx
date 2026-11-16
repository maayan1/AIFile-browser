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
  const sent: { id: string; type: string; path?: string; text?: string; folder?: string }[] = [];
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

// The shell's opener: records each file the app asks Windows to open.
const opened = vi.hoisted(() => [] as string[]);
vi.mock("./shell/open", () => ({
  openFile: async (path: string) => {
    opened.push(path);
  },
}));

// The dev readout logs to the console; keep test output quiet.
const info = vi.spyOn(console, "info").mockImplementation(() => {});

afterEach(() => {
  cleanup();
  shell.sent.length = 0;
  opened.length = 0;
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

  it("shows a file in another folder with its row selected, and Back returns", async () => {
    await readyApp();
    reply(listingOf(lastRequest("listFolder").id, DOCS, [{ kind: "knownFolder", code: "documents", path: DOCS }]));
    await flush();
    const main = within(screen.getByRole("main"));
    const docx = "סיכום ישיבה 3.docx";

    // The context menu's Show in folder asks the engine on the listing channel.
    act(() => fireEvent.contextMenu(main.getByText(docx), { button: 2, clientX: 50, clientY: 50 }));
    act(() => fireEvent.click(screen.getByRole("menuitem", { name: t("menu.showInFolder") })));
    const request = lastRequest("showInFolder");
    expect(request.path).toBe(`${DOCS}\\${docx}`);

    // The engine names the folder; here another one, as for a search result (Story 2.2).
    const work = "D:\\Work";
    reply({
      ...listingOf(request.id, work, [
        { kind: "drive", letter: "D", label: null, path: "D:\\" },
        { kind: "folder", name: "Work", path: work },
      ]),
      parent: "D:\\",
      selected: docx,
    });
    await flush();
    const crumbs = within(screen.getByRole("group", { name: t("breadcrumb.label") }));
    expect(crumbs.getByRole("button", { name: "Work" }).getAttribute("aria-current")).toBe("location");
    const row = main.getByText(docx).closest("tr")!;
    expect(row.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(row);
    expect(main.getByText("Photos").closest("tr")!.getAttribute("aria-selected")).toBe("false");

    act(() => fireEvent.click(screen.getByRole("button", { name: t("topBar.back") })));
    expect(lastRequest("listFolder").path).toBe(DOCS);
  });

  it("shows the permission message for a folder it can't open, and Back, Up and the breadcrumb still work", async () => {
    await readyApp();
    reply(listingOf(lastRequest("listFolder").id, DOCS, [{ kind: "knownFolder", code: "documents", path: DOCS }]));
    await flush();
    const main = within(screen.getByRole("main"));
    const button = (name: string) => screen.getByRole<HTMLButtonElement>("button", { name });
    const photos = `${DOCS}\\Photos`;
    const place = {
      path: photos,
      parent: DOCS,
      segments: [
        { kind: "knownFolder", code: "documents", path: DOCS },
        { kind: "folder", name: "Photos", path: photos },
      ],
    };
    const deny = () => reply({ id: lastRequest("listFolder").id, type: "error", code: "accessDenied", data: place });

    // The engine can't list the folder: the list says so in plain words, and nothing else.
    act(() => fireEvent.doubleClick(main.getByText("Photos")));
    expect(lastRequest("listFolder").path).toBe(photos);
    deny();
    await flush();
    expect(main.getByText(t("browse.accessDenied"))).toBeTruthy();
    expect(main.queryAllByRole("row")).toHaveLength(0);
    expect(screen.queryByText(/accessDenied/)).toBeNull();
    const crumbs = () => within(screen.getByRole("group", { name: t("breadcrumb.label") }));
    expect(crumbs().getByRole("button", { name: "Photos" }).getAttribute("aria-current")).toBe("location");
    expect(button(t("topBar.up")).disabled).toBe(false);

    // Back lists the previous folder.
    expect(button(t("topBar.back")).disabled).toBe(false);
    act(() => fireEvent.click(button(t("topBar.back"))));
    expect(lastRequest("listFolder").path).toBe(DOCS);
    reply(listingOf(lastRequest("listFolder").id, DOCS, [{ kind: "knownFolder", code: "documents", path: DOCS }]));
    await flush();
    expect(main.getByText("Photos")).toBeTruthy();
    expect(main.queryByText(t("browse.accessDenied"))).toBeNull();

    // Forward to the denied folder again; Up and the breadcrumb each leave it.
    act(() => fireEvent.click(button(t("topBar.forward"))));
    expect(lastRequest("listFolder").path).toBe(photos);
    deny();
    await flush();
    act(() => fireEvent.click(button(t("topBar.up"))));
    expect(lastRequest("listFolder").path).toBe(DOCS);
    reply(listingOf(lastRequest("listFolder").id, DOCS, [{ kind: "knownFolder", code: "documents", path: DOCS }]));
    await flush();
    expect(main.getByText("Photos")).toBeTruthy();
    act(() => fireEvent.click(button(t("topBar.back"))));
    expect(lastRequest("listFolder").path).toBe(photos);
    deny();
    await flush();
    act(() => fireEvent.click(crumbs().getByRole("button", { name: "Documents" })));
    expect(lastRequest("listFolder").path).toBe(DOCS);
    reply(listingOf(lastRequest("listFolder").id, DOCS, [{ kind: "knownFolder", code: "documents", path: DOCS }]));
    await flush();
    expect(main.getByText("Photos")).toBeTruthy();
    expect(main.queryByText(t("browse.accessDenied"))).toBeNull();
  });

  it("browses with the keyboard alone: Enter, ↓, Alt+↑, Alt+←, Alt+→ and F5", async () => {
    await readyApp();
    const docsSegments = [{ kind: "knownFolder", code: "documents", path: DOCS }];
    const photos = `${DOCS}\\Photos`;
    const photosSegments = [...docsSegments, { kind: "folder", name: "Photos", path: photos }];
    reply(listingOf(lastRequest("listFolder").id, DOCS, docsSegments));
    await flush();
    const main = within(screen.getByRole("main"));
    const row = (name: string) => main.getByText(name).closest("tr")!;
    const selected = () => main.getAllByRole("row").filter((r) => r.getAttribute("aria-selected") === "true");
    const key = (init: object) => fireEvent.keyDown(document.activeElement!, init);
    const listFolders = () => shell.sent.filter((m) => m.type === "listFolder").length;
    const backButton = () => screen.getByRole<HTMLButtonElement>("button", { name: t("topBar.back") });
    const forwardButton = () => screen.getByRole<HTMLButtonElement>("button", { name: t("topBar.forward") });

    // The first listing takes focus on its first row, with nothing selected.
    expect(document.activeElement).toBe(row("Photos"));
    expect(selected()).toEqual([]);

    // Enter opens the folder; its first row takes focus.
    act(() => void key({ key: "Enter" }));
    expect(lastRequest("listFolder").path).toBe(photos);
    reply(listingOf(lastRequest("listFolder").id, photos, photosSegments));
    await flush();
    expect(document.activeElement).toBe(row("Photos"));
    expect(selected()).toEqual([]);

    // ↓ selects the focused row, ↓ again moves on.
    act(() => void key({ key: "ArrowDown" }));
    expect(selected()).toEqual([row("Photos")]);
    act(() => void key({ key: "ArrowDown" }));
    expect(selected()).toEqual([row("סיכום ישיבה 3.docx")]);
    expect(document.activeElement).toBe(row("סיכום ישיבה 3.docx"));

    // F5 lists the same folder again, keeps the selection and focus, and stops the page reload.
    const before = listFolders();
    let unprevented = true;
    act(() => void (unprevented = key({ key: "F5" })));
    expect(unprevented).toBe(false);
    expect(listFolders()).toBe(before + 1);
    expect(lastRequest("listFolder").path).toBe(photos);
    reply(listingOf(lastRequest("listFolder").id, photos, photosSegments));
    await flush();
    expect(selected()).toEqual([row("סיכום ישיבה 3.docx")]);
    expect(document.activeElement).toBe(row("סיכום ישיבה 3.docx"));
    expect(backButton().disabled).toBe(false); // history unchanged
    expect(forwardButton().disabled).toBe(true);

    // Alt+↑ goes to the parent; focus on its first row, nothing selected.
    act(() => void key({ key: "ArrowUp", altKey: true }));
    expect(lastRequest("listFolder").path).toBe(DOCS);
    reply(listingOf(lastRequest("listFolder").id, DOCS, docsSegments));
    await flush();
    expect(document.activeElement).toBe(row("Photos"));
    expect(selected()).toEqual([]);

    // Alt+← back to Photos, Alt+→ forward to Documents.
    act(() => void key({ key: "ArrowLeft", altKey: true }));
    expect(lastRequest("listFolder").path).toBe(photos);
    reply(listingOf(lastRequest("listFolder").id, photos, photosSegments));
    await flush();
    expect(forwardButton().disabled).toBe(false);
    act(() => void key({ key: "ArrowRight", altKey: true }));
    expect(lastRequest("listFolder").path).toBe(DOCS);
    reply(listingOf(lastRequest("listFolder").id, DOCS, docsSegments));
    await flush();
    expect(forwardButton().disabled).toBe(true);

    // F5 from the open path field lists the folder again too, and stops the page reload.
    act(() => fireEvent.keyDown(window, { key: "d", code: "KeyD", altKey: true }));
    const field = screen.getByRole("textbox", { name: t("breadcrumb.field") });
    expect(document.activeElement).toBe(field);
    const count = listFolders();
    act(() => void (unprevented = fireEvent.keyDown(field, { key: "F5" })));
    expect(unprevented).toBe(false);
    expect(listFolders()).toBe(count + 1);
    expect(lastRequest("listFolder").path).toBe(DOCS);
    reply(listingOf(lastRequest("listFolder").id, DOCS, docsSegments));
    await flush();
    expect(backButton().disabled).toBe(false);
    expect(document.activeElement).toBe(field); // focus in the top bar is never taken
  });

  it("opens a file through the shell and keeps the folder", async () => {
    await readyApp();
    reply(listingOf(lastRequest("listFolder").id, DOCS, [{ kind: "knownFolder", code: "documents", path: DOCS }]));
    await flush();
    const sent = shell.sent.length;
    act(() => fireEvent.doubleClick(within(screen.getByRole("main")).getByText("סיכום ישיבה 3.docx")));
    await flush();
    expect(opened).toEqual([`${DOCS}\\סיכום ישיבה 3.docx`]);
    expect(shell.sent.length).toBe(sent);
    expect(within(screen.getByRole("main")).getByText("Photos")).toBeTruthy();
  });

  it("searches the listed folder on Enter only, with a spinner until searchDone", async () => {
    await readyApp();
    const bar = () => screen.getByRole<HTMLInputElement>("textbox", { name: t("search.label") });
    const searches = () => shell.sent.filter((m) => m.type === "search");
    const icon = () => bar().parentElement!.querySelector("svg")!;
    const spinning = () => icon().classList.contains("lucide-loader-circle");

    // With no folder listed yet, Enter sends nothing.
    act(() => fireEvent.change(bar(), { target: { value: "report" } }));
    act(() => void fireEvent.keyDown(bar(), { key: "Enter" }));
    expect(searches()).toEqual([]);

    reply(listingOf(lastRequest("listFolder").id, DOCS, [{ kind: "knownFolder", code: "documents", path: DOCS }]));
    await flush();

    // Typing sends nothing; blank text sends nothing on Enter.
    act(() => fireEvent.change(bar(), { target: { value: "   " } }));
    act(() => void fireEvent.keyDown(bar(), { key: "Enter" }));
    act(() => fireEvent.change(bar(), { target: { value: "report" } }));
    expect(searches()).toEqual([]);
    expect(icon().getAttribute("aria-hidden")).toBe("true");
    expect(spinning()).toBe(false);
    expect(bar().getAttribute("aria-busy")).toBe("false");

    // An Enter that ends an IME composition sends nothing.
    act(() => void fireEvent.keyDown(bar(), { key: "Enter", isComposing: true }));
    expect(searches()).toEqual([]);
    expect(spinning()).toBe(false);

    // Enter sends one search for the listed folder; the spinner replaces the magnifier.
    act(() => void fireEvent.keyDown(bar(), { key: "Enter" }));
    // A held Enter's repeats send no more.
    act(() => void fireEvent.keyDown(bar(), { key: "Enter", repeat: true }));
    act(() => void fireEvent.keyDown(bar(), { key: "Enter", repeat: true }));
    expect(searches()).toEqual([{ id: expect.any(String), type: "search", text: "report", folder: DOCS }]);
    const id = searches()[0].id;
    expect(spinning()).toBe(true);
    expect(icon().getAttribute("aria-hidden")).toBe("true");
    expect(bar().getAttribute("aria-busy")).toBe("true");

    reply({ id, type: "searchParsed", mode: "normal", dateRange: null, residualText: "report" });
    reply({ id, type: "nameMatches", matches: [] });
    expect(spinning()).toBe(true);
    reply({ id, type: "searchDone", notices: [], indexVersion: null, indexingActive: false });
    await flush();
    expect(spinning()).toBe(false);
    expect(bar().getAttribute("aria-busy")).toBe("false");

    // A second Enter replaces the first; an error reply stops the spinner too.
    act(() => void fireEvent.keyDown(bar(), { key: "Enter" }));
    act(() => void fireEvent.keyDown(bar(), { key: "Enter" }));
    expect(searches()).toHaveLength(3);
    reply({ id: searches()[1].id, type: "cancelled" });
    await flush();
    expect(spinning()).toBe(true);
    reply({ id: searches()[2].id, type: "error", code: "folderNotFound", data: {} });
    await flush();
    expect(spinning()).toBe(false);
  });

  it("dev only: logs each search's ms from Enter to its results on screen, never the search text", async () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
    try {
      await readyApp();
      reply(listingOf(lastRequest("listFolder").id, DOCS, [{ kind: "knownFolder", code: "documents", path: DOCS }]));
      await flush();
      info.mockClear();
      const bar = screen.getByRole<HTMLInputElement>("textbox", { name: t("search.label") });
      act(() => fireEvent.change(bar, { target: { value: "secret words" } }));
      act(() => void fireEvent.keyDown(bar, { key: "Enter" }));
      const id = lastRequest("search").id;
      reply({ id, type: "searchParsed", mode: "normal", dateRange: null, residualText: "secret words" });
      reply({ id, type: "searchDone", notices: [], indexVersion: null, indexingActive: false });
      await flush();
      // Run every frame asked for, including the ones asked for inside a frame.
      act(() => {
        while (frames.length) frames.shift()!(0);
      });
      const onScreen = info.mock.calls.filter((call) => call[0] === "[search] on screen");
      expect(onScreen).toEqual([["[search] on screen", id, expect.stringMatching(/^\d+ ms$/)]]);
      expect(JSON.stringify(info.mock.calls)).not.toContain("secret");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("searches nothing while a folder loads or when it can't be listed", async () => {
    await readyApp();
    reply(listingOf(lastRequest("listFolder").id, DOCS, [{ kind: "knownFolder", code: "documents", path: DOCS }]));
    await flush();
    const bar = () => screen.getByRole<HTMLInputElement>("textbox", { name: t("search.label") });
    const searches = () => shell.sent.filter((m) => m.type === "search");
    const enter = () => act(() => void fireEvent.keyDown(bar(), { key: "Enter" }));
    act(() => fireEvent.change(bar(), { target: { value: "report" } }));

    // Another folder is opening: the listing on screen is the one being left, so Enter waits.
    act(() => fireEvent.doubleClick(within(screen.getByRole("main")).getByText("Photos")));
    const photos = `${DOCS}\\Photos`;
    expect(lastRequest("listFolder").path).toBe(photos);
    enter();
    expect(searches()).toEqual([]);
    reply(
      listingOf(lastRequest("listFolder").id, photos, [
        { kind: "knownFolder", code: "documents", path: DOCS },
        { kind: "folder", name: "Photos", path: photos },
      ]),
    );
    await flush();
    enter();
    expect(searches().map((m) => m.folder)).toEqual([photos]);

    // A folder that can't be listed leaves no listing: Enter sends nothing.
    act(() => fireEvent.doubleClick(within(screen.getByRole("main")).getByText("Photos")));
    reply({ id: lastRequest("listFolder").id, type: "error", code: "accessDenied", data: {} });
    await flush();
    expect(within(screen.getByRole("main")).getByText(t("browse.accessDenied"))).toBeTruthy();
    enter();
    expect(searches()).toHaveLength(1);
  });

  it("clears the Search Bar with ✕ and focuses it with Ctrl+E, Ctrl+F or F3, its text selected", async () => {
    await readyApp();
    const bar = () => screen.getByRole<HTMLInputElement>("textbox", { name: t("search.label") });
    expect(screen.queryByRole("button", { name: t("search.clear") })).toBeNull();

    act(() => fireEvent.change(bar(), { target: { value: "דוח" } }));
    const clear = screen.getByRole("button", { name: t("search.clear") });
    expect(clear.getAttribute("title")).toBe(t("search.clear"));
    act(() => fireEvent.click(clear));
    expect(bar().value).toBe("");
    expect(document.activeElement).toBe(bar());
    expect(screen.queryByRole("button", { name: t("search.clear") })).toBeNull();

    const keys = [
      { key: "e", code: "KeyE", ctrlKey: true },
      { key: "f", code: "KeyF", ctrlKey: true },
      { key: "F3", code: "F3" },
    ];
    for (const init of keys) {
      act(() => fireEvent.change(bar(), { target: { value: "report final" } }));
      bar().setSelectionRange(0, 0);
      act(() => (document.activeElement as HTMLElement).blur());
      expect(document.activeElement).not.toBe(bar());
      let unprevented = true;
      act(() => void (unprevented = fireEvent.keyDown(window, init)));
      expect(unprevented, init.code).toBe(false);
      expect(document.activeElement).toBe(bar());
      expect([bar().selectionStart, bar().selectionEnd]).toEqual([0, "report final".length]);
    }
    expect(shell.sent.filter((m) => m.type === "search")).toEqual([]);
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

describe("App search view", () => {
  const docsSegments = [{ kind: "knownFolder", code: "documents", path: DOCS }];
  const bar = () => screen.getByRole<HTMLInputElement>("textbox", { name: t("search.label") });
  const main = () => within(screen.getByRole("main"));
  const option = (name: string) => main().getAllByRole("option").find((o) => o.querySelector("bdi")!.textContent === name)!;
  const inView = () => main().queryByRole("table") === null;
  const match = (name: string, folder: string, kind: "file" | "folder" = "file") =>
    kind === "folder"
      ? { name, kind, path: `${folder}\\${name}`, folder, modified: null }
      : { name, kind, typeCode: "pdf", path: `${folder}\\${name}`, folder, modified: "2025-10-14T12:00:00+00:00" };

  async function listed() {
    await readyApp();
    reply(listingOf(lastRequest("listFolder").id, DOCS, docsSegments));
    reply({
      id: lastRequest("listLocations").id,
      type: "locations",
      knownFolders: [{ code: "documents", path: DOCS }],
      drives: [{ letter: "C", label: null, path: "C:\\" }],
    });
    await flush();
  }

  /** Types `text`, presses Enter and answers with `matches` (and the engine's outcome). */
  async function searchFor(text: string, matches: object[], outcomeCode?: string) {
    act(() => fireEvent.change(bar(), { target: { value: text } }));
    const sent = shell.sent.filter((m) => m.type === "search").length;
    act(() => void fireEvent.keyDown(bar(), { key: "Enter" }));
    expect(shell.sent.filter((m) => m.type === "search")).toHaveLength(sent + 1);
    expect(inView()).toBe(true);
    const id = lastRequest("search").id;
    reply({ id, type: "searchParsed", mode: "normal", dateRange: null, residualText: text });
    reply({ id, type: "nameMatches", matches });
    reply({ id, type: "searchDone", ...(outcomeCode ? { outcomeCode } : {}), notices: [], indexVersion: null, indexingActive: false });
    await flush();
    return id;
  }

  it("shows the results on Enter, and Esc or ✕ go back to the folder with the text cleared", async () => {
    await listed();
    expect(inView()).toBe(false);
    const volunteering = `${DOCS}\\Volunteering`;
    act(() => fireEvent.change(bar(), { target: { value: "report" } }));
    act(() => void fireEvent.keyDown(bar(), { key: "Enter" }));
    // The view opens at once; nothing to show until matches arrive.
    expect(inView()).toBe(true);
    expect(main().queryByRole("listbox")).toBeNull();
    const id = lastRequest("search").id;
    reply({ id, type: "searchParsed", mode: "normal", dateRange: null, residualText: "report" });
    reply({ id, type: "nameMatches", matches: [match("report.pdf", DOCS), match("report-final.docx", volunteering)] });
    expect(main().getByRole("heading", { name: "Name matches (2)" })).toBeTruthy();
    expect(main().getByRole("status").textContent).toBe(""); // still running
    reply({ id, type: "searchDone", notices: [], indexVersion: null, indexingActive: false });
    await flush();
    expect(main().getByRole("status").textContent).toBe("2 name matches found");
    expect(option("report-final.docx").querySelector("p")!.textContent).toBe("Documents › Volunteering · Oct 14, 2025");

    // Esc from the Search Bar: the folder again, the text cleared, focus kept.
    act(() => bar().focus());
    expect(fireEvent.keyDown(bar(), { key: "Escape" })).toBe(false);
    expect(inView()).toBe(false);
    expect(bar().value).toBe("");
    expect(document.activeElement).toBe(bar());
    expect(main().getByText("Photos")).toBeTruthy();
    // Whatever still arrives for the left search is dropped; it had finished, so no cancel is sent.
    reply({ id, type: "nameMatches", matches: [match("late.pdf", DOCS)] });
    await flush();
    expect(inView()).toBe(false);
    expect(shell.sent.some((m) => m.type === "cancel")).toBe(false);
    // Esc with the view closed does nothing.
    expect(fireEvent.keyDown(bar(), { key: "Escape" })).toBe(true);

    // EARS-03, then ✕.
    await searchFor("xyz123", [], "noMatches");
    expect(main().getByText(t("search.noMatches"), { selector: "p" })).toBeTruthy();
    expect(main().getByText(t("search.tryDifferentWords"))).toBeTruthy();
    expect(main().getByRole("status").textContent).toBe("No matching files found");
    act(() => fireEvent.click(screen.getByRole("button", { name: t("search.clear") })));
    expect(inView()).toBe(false);
    expect(bar().value).toBe("");
    expect(document.activeElement).toBe(bar());
  });

  const banner = () => document.querySelector<HTMLElement>("[data-notices]");
  const cancels = () => shell.sent.filter((m) => m.type === "cancel");

  it("Esc while a search runs cancels it: the rows, text and focus stay, 'Search stopped.'; Esc again leaves", async () => {
    await listed();
    act(() => fireEvent.change(bar(), { target: { value: "report" } }));
    act(() => void fireEvent.keyDown(bar(), { key: "Enter" }));
    const id = lastRequest("search").id;
    reply({ id, type: "searchParsed", mode: "normal", dateRange: null, residualText: "report" });
    reply({ id, type: "nameMatches", matches: Array.from({ length: 30 }, (_, i) => match(`report ${i}.pdf`, DOCS)) });
    await flush();
    const row = option("report 3.pdf");
    act(() => row.focus());
    act(() => void fireEvent.keyDown(row, { key: "Escape" }));
    // The cancel shares the search's id; the search runs until its reply.
    expect(cancels()).toEqual([{ id, type: "cancel" }]);
    expect(inView()).toBe(true);
    expect(bar().getAttribute("aria-busy")).toBe("true");
    reply({ id, type: "cancelled" });
    await flush();
    expect(bar().getAttribute("aria-busy")).toBe("false");
    expect(main().getAllByRole("option")).toHaveLength(30);
    expect(banner()!.textContent).toBe("Search stopped.");
    expect(main().getByRole("status").textContent).toBe("Search stopped.");
    expect(bar().value).toBe("report");
    expect(document.activeElement).toBe(row);
    expect(main().queryByText(t("search.noMatches"))).toBeNull();

    // The second Esc leaves the view, the text cleared, and sends nothing more.
    act(() => void fireEvent.keyDown(row, { key: "Escape" }));
    expect(inView()).toBe(false);
    expect(bar().value).toBe("");
    expect(document.activeElement).toBe(bar());
    expect(cancels()).toHaveLength(1);
  });

  it("Esc before any match: the banner only, never 'No matching files found'", async () => {
    await listed();
    act(() => bar().focus());
    act(() => fireEvent.change(bar(), { target: { value: "report" } }));
    act(() => void fireEvent.keyDown(bar(), { key: "Enter" }));
    const id = lastRequest("search").id;
    act(() => void fireEvent.keyDown(bar(), { key: "Escape" }));
    reply({ id, type: "cancelled" });
    await flush();
    expect(inView()).toBe(true);
    expect(banner()!.textContent).toBe("Search stopped.");
    expect(main().queryByText(t("search.noMatches"))).toBeNull();
    expect(main().queryByRole("listbox")).toBeNull();
    expect(document.activeElement).toBe(bar());
  });

  it("a new Enter replaces a running search with no cancel, and clears 'Search stopped.'", async () => {
    await listed();
    act(() => fireEvent.change(bar(), { target: { value: "report" } }));
    act(() => void fireEvent.keyDown(bar(), { key: "Enter" }));
    const first = lastRequest("search").id;
    act(() => void fireEvent.keyDown(bar(), { key: "Escape" }));
    reply({ id: first, type: "cancelled" });
    await flush();
    expect(banner()).toBeTruthy();

    act(() => fireEvent.change(bar(), { target: { value: "photo" } }));
    act(() => void fireEvent.keyDown(bar(), { key: "Enter" }));
    const second = lastRequest("search").id;
    expect(banner()).toBeNull();
    reply({ id: second, type: "nameMatches", matches: [match("old photo.pdf", DOCS)] });
    act(() => fireEvent.change(bar(), { target: { value: "budget" } }));
    act(() => void fireEvent.keyDown(bar(), { key: "Enter" }));
    const third = lastRequest("search").id;
    expect(cancels()).toHaveLength(1); // the engine's latest-wins ends the second
    reply({ id: second, type: "cancelled" });
    reply({ id: third, type: "nameMatches", matches: [match("budget.pdf", DOCS)] });
    reply({ id: third, type: "searchDone", notices: [], indexVersion: null, indexingActive: false });
    await flush();
    expect(main().getAllByRole("option").map((o) => o.querySelector("bdi")!.textContent)).toEqual(["budget.pdf"]);
    expect(banner()).toBeNull();
    expect(main().getByRole("status").textContent).toBe("1 name match found");
  });

  it("✕ or a navigation during a search cancels it, leaves, and drops its late replies", async () => {
    await listed();
    act(() => fireEvent.change(bar(), { target: { value: "report" } }));
    act(() => void fireEvent.keyDown(bar(), { key: "Enter" }));
    const first = lastRequest("search").id;
    act(() => fireEvent.click(screen.getByRole("button", { name: t("search.clear") })));
    expect(cancels()).toEqual([{ id: first, type: "cancel" }]);
    expect(inView()).toBe(false);
    reply({ id: first, type: "nameMatches", matches: [match("late.pdf", DOCS)] });
    reply({ id: first, type: "cancelled" });
    await flush();
    expect(inView()).toBe(false);

    act(() => fireEvent.change(bar(), { target: { value: "report" } }));
    act(() => void fireEvent.keyDown(bar(), { key: "Enter" }));
    const second = lastRequest("search").id;
    const nav = within(screen.getByRole("navigation", { name: t("nav.label") }));
    act(() => fireEvent.click(nav.getByRole("button", { name: "Local Disk (C:)" })));
    expect(cancels().at(-1)).toEqual({ id: second, type: "cancel" });
    expect(inView()).toBe(false);
    expect(bar().value).toBe("");
    reply({ id: second, type: "cancelled" });
    await flush();
    expect(inView()).toBe(false);
  });

  it("shows the permission notice above the results, and above the empty state", async () => {
    await listed();
    act(() => fireEvent.change(bar(), { target: { value: "report" } }));
    act(() => void fireEvent.keyDown(bar(), { key: "Enter" }));
    let id = lastRequest("search").id;
    reply({ id, type: "nameMatches", matches: [match("report.pdf", DOCS)] });
    reply({ id, type: "searchDone", notices: ["permissionSkipped"], indexVersion: null, indexingActive: false });
    await flush();
    expect(main().getAllByRole("option")).toHaveLength(1);
    expect(banner()!.textContent).toBe(t("search.permissionSkipped"));
    expect(main().getByRole("status").textContent).toBe(`1 name match found. ${t("search.permissionSkipped")}`);

    act(() => fireEvent.change(bar(), { target: { value: "xyz123" } }));
    act(() => void fireEvent.keyDown(bar(), { key: "Enter" }));
    id = lastRequest("search").id;
    reply({ id, type: "nameMatches", matches: [] });
    reply({ id, type: "searchDone", outcomeCode: "noMatches", notices: ["permissionSkipped"], indexVersion: null, indexingActive: false });
    await flush();
    expect(banner()!.textContent).toBe(t("search.permissionSkipped"));
    expect(main().getByText(t("search.noMatches"), { selector: "p" })).toBeTruthy();
    expect(cancels()).toEqual([]);
  });

  it("shows the folder's error when the searched folder is gone", async () => {
    await listed();
    act(() => fireEvent.change(bar(), { target: { value: "report" } }));
    act(() => void fireEvent.keyDown(bar(), { key: "Enter" }));
    reply({ id: lastRequest("search").id, type: "error", code: "folderNotFound", data: {} });
    await flush();
    expect(inView()).toBe(true);
    expect(main().getByText(t("browse.folderNotFound"))).toBeTruthy();
    expect(main().queryByText(t("search.noMatches"))).toBeNull();
  });

  it("leaves with Esc from a row (focus to the Search Bar), but Esc in the row menu only closes it", async () => {
    await listed();
    await searchFor("report", [match("report.pdf", DOCS)]);
    const row = option("report.pdf");
    act(() => row.focus());
    act(() => void fireEvent.keyDown(row, { key: "F10", shiftKey: true }));
    expect(screen.getByRole("menu")).toBeTruthy();
    act(() => void fireEvent.keyDown(document.activeElement!, { key: "Escape" }));
    expect(screen.queryByRole("menu")).toBeNull();
    expect(inView()).toBe(true);
    expect(document.activeElement).toBe(row);
    act(() => void fireEvent.keyDown(row, { key: "Escape" }));
    expect(inView()).toBe(false);
    expect(document.activeElement).toBe(bar());

    // Esc while the search still runs stops it and stays; the next Esc leaves.
    act(() => fireEvent.change(bar(), { target: { value: "photo" } }));
    act(() => void fireEvent.keyDown(bar(), { key: "Enter" }));
    expect(inView()).toBe(true);
    act(() => void fireEvent.keyDown(bar(), { key: "Escape" }));
    expect(inView()).toBe(true);
    reply({ id: lastRequest("search").id, type: "cancelled" });
    await flush();
    expect(bar().getAttribute("aria-busy")).toBe("false");
    act(() => void fireEvent.keyDown(bar(), { key: "Escape" }));
    expect(inView()).toBe(false);

    // The Esc that closes the path field leaves the view open.
    await searchFor("report", [match("report.pdf", DOCS)]);
    act(() => fireEvent.keyDown(window, { key: "d", code: "KeyD", altKey: true }));
    const field = screen.getByRole("textbox", { name: t("breadcrumb.field") });
    act(() => void fireEvent.keyDown(field, { key: "Escape" }));
    expect(screen.queryByRole("textbox", { name: t("breadcrumb.field") })).toBeNull();
    expect(inView()).toBe(true);
  });

  it("stays in the view for F5 and opening a file; any navigation leaves it", async () => {
    await listed();
    const projects = `${DOCS}\\Projects`;
    const work = `${DOCS}\\Work`;
    const results = [match("Acme", projects, "folder"), match("report.pdf", work)];
    await searchFor("a", results);

    // Opening a file, and F5: still searching.
    act(() => void fireEvent.keyDown(option("report.pdf"), { key: "Enter" }));
    await flush();
    expect(opened).toEqual([`${work}\\report.pdf`]);
    const lists = shell.sent.filter((m) => m.type === "listFolder").length;
    act(() => void fireEvent.keyDown(window, { key: "F5" }));
    expect(shell.sent.filter((m) => m.type === "listFolder")).toHaveLength(lists + 1);
    reply(listingOf(lastRequest("listFolder").id, DOCS, docsSegments));
    await flush();
    expect(inView()).toBe(true);
    expect(bar().value).toBe("a");

    // A folder row opens that folder: the browse view, the text cleared.
    act(() => void fireEvent.keyDown(option("Acme"), { key: "Enter" }));
    expect(lastRequest("listFolder").path).toBe(`${projects}\\Acme`);
    expect(inView()).toBe(false);
    expect(bar().value).toBe("");
    reply(
      listingOf(lastRequest("listFolder").id, `${projects}\\Acme`, [
        ...docsSegments,
        { kind: "folder", name: "Projects", path: projects },
        { kind: "folder", name: "Acme", path: `${projects}\\Acme` },
      ]),
    );
    await flush();

    // Show in folder: the browse view of its folder with the file selected.
    await searchFor("a", results);
    act(() => void fireEvent.keyDown(option("report.pdf"), { key: "E", code: "KeyE", ctrlKey: true, shiftKey: true }));
    const show = lastRequest("showInFolder");
    expect(show.path).toBe(`${work}\\report.pdf`);
    expect(inView()).toBe(false);
    reply({
      ...listingOf(show.id, work, [...docsSegments, { kind: "folder", name: "Work", path: work }]),
      entries: [{ name: "report.pdf", kind: "file", typeCode: "pdf", size: 1, modified: null }],
      selected: "report.pdf",
    });
    await flush();
    expect(main().getByText("report.pdf").closest("tr")!.getAttribute("aria-selected")).toBe("true");

    // The nav pane, Back and the breadcrumb leave it too.
    await searchFor("a", results);
    const nav = within(screen.getByRole("navigation", { name: t("nav.label") }));
    act(() => fireEvent.click(nav.getByRole("button", { name: "Local Disk (C:)" })));
    expect(lastRequest("listFolder").path).toBe("C:\\");
    expect(inView()).toBe(false);
    reply({ ...listingOf(lastRequest("listFolder").id, "C:\\", [{ kind: "drive", letter: "C", label: null, path: "C:\\" }]), parent: null });
    await flush();

    await searchFor("a", results);
    act(() => fireEvent.click(screen.getByRole("button", { name: t("topBar.back") })));
    expect(lastRequest("listFolder").path).toBe(work);
    expect(inView()).toBe(false);
    reply(listingOf(lastRequest("listFolder").id, work, [...docsSegments, { kind: "folder", name: "Work", path: work }]));
    await flush();

    await searchFor("a", results);
    const crumbs = within(screen.getByRole("group", { name: t("breadcrumb.label") }));
    act(() => fireEvent.click(crumbs.getByRole("button", { name: "Documents" })));
    expect(lastRequest("listFolder").path).toBe(DOCS);
    expect(inView()).toBe(false);
    expect(bar().value).toBe("");
  });

  it("leaves on Up, Forward and a typed path, but not on Back or Forward with nowhere to go", async () => {
    await listed();
    const dana = "C:\\Users\\dana";
    const results = [match("report.pdf", DOCS)];
    const lists = () => shell.sent.filter((m) => m.type === "listFolder").length;
    const leftFor = (path: string) => {
      expect(lastRequest("listFolder").path).toBe(path);
      expect(inView()).toBe(false);
      expect(bar().value).toBe("");
    };

    // No history yet: Alt+← and Alt+→ go nowhere, so the view and its text stay.
    await searchFor("a", results);
    const before = lists();
    act(() => void fireEvent.keyDown(window, { key: "ArrowLeft", altKey: true }));
    act(() => void fireEvent.keyDown(window, { key: "ArrowRight", altKey: true }));
    expect(lists()).toBe(before);
    expect(inView()).toBe(true);
    expect(bar().value).toBe("a");

    // Alt+↑ goes up a folder.
    act(() => void fireEvent.keyDown(window, { key: "ArrowUp", altKey: true }));
    leftFor(dana);
    reply(listingOf(lastRequest("listFolder").id, dana, [{ kind: "folder", name: "dana", path: dana }]));
    await flush();

    // The Up button.
    await searchFor("a", results);
    act(() => fireEvent.click(screen.getByRole("button", { name: t("topBar.up") })));
    leftFor("C:\\Users");
    reply(listingOf(lastRequest("listFolder").id, "C:\\Users", [{ kind: "folder", name: "Users", path: "C:\\Users" }]));
    await flush();

    // Back (without searching), then Forward from the search view.
    act(() => fireEvent.click(screen.getByRole("button", { name: t("topBar.back") })));
    reply(listingOf(lastRequest("listFolder").id, dana, [{ kind: "folder", name: "dana", path: dana }]));
    await flush();
    await searchFor("a", results);
    act(() => fireEvent.click(screen.getByRole("button", { name: t("topBar.forward") })));
    leftFor("C:\\Users");
    reply(listingOf(lastRequest("listFolder").id, "C:\\Users", [{ kind: "folder", name: "Users", path: "C:\\Users" }]));
    await flush();

    // Alt+→ with history to go to.
    act(() => fireEvent.click(screen.getByRole("button", { name: t("topBar.back") })));
    reply(listingOf(lastRequest("listFolder").id, dana, [{ kind: "folder", name: "dana", path: dana }]));
    await flush();
    await searchFor("a", results);
    act(() => void fireEvent.keyDown(window, { key: "ArrowRight", altKey: true }));
    leftFor("C:\\Users");
    reply(listingOf(lastRequest("listFolder").id, "C:\\Users", [{ kind: "folder", name: "Users", path: "C:\\Users" }]));
    await flush();

    // A typed path: Alt+D, the path and Enter.
    await searchFor("a", results);
    act(() => fireEvent.keyDown(window, { key: "d", code: "KeyD", altKey: true }));
    const field = screen.getByRole("textbox", { name: t("breadcrumb.field") });
    act(() => fireEvent.change(field, { target: { value: "C:\\Work" } }));
    act(() => void fireEvent.keyDown(field, { key: "Enter" }));
    leftFor("C:\\Work");
  });
});
