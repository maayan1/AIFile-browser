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
vi.spyOn(console, "info").mockImplementation(() => {});

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
