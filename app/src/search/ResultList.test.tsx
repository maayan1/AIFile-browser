// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import type { BrowseActions, Place } from "@/browse/session";
import { t } from "@/i18n/catalog";
import type { SearchDone, SearchParsed } from "@/protocol/generated";
import { ResultList, matchLocation } from "./ResultList";
import { INITIAL_SEARCH, type NameMatch, type SearchSnapshot } from "./session";

afterEach(cleanup);

// The Correct Display list, loaded through Vite like the protocol examples.
const fixtures = import.meta.glob<{ entries: { segments: string[]; name: string; kind: "file" | "folder" }[] }>(
  "../../../fixtures/correct-display-names.json",
  { eager: true, import: "default" },
);
const CORRECT_DISPLAY = Object.values(fixtures)[0].entries;

const DOCS = "C:\\Users\\dana\\Documents";
const ROOT: Place = {
  path: DOCS,
  parent: "C:\\Users\\dana",
  segments: [{ kind: "knownFolder", code: "documents", path: DOCS }],
};
const PARSED: SearchParsed = { id: "q1", type: "searchParsed", mode: "normal", dateRange: null, residualText: "report" };
const DONE: SearchDone = { id: "q1", type: "searchDone", notices: [], indexVersion: null, indexingActive: false };
const NO_MATCHES: SearchDone = { ...DONE, outcomeCode: "noMatches" };
const PERMISSION_SKIPPED: SearchDone = { ...DONE, notices: ["permissionSkipped"] };
const OCT_14 = "2025-10-14T12:00:00+00:00";

function file(name: string, folder = DOCS, modified: string | null = OCT_14): NameMatch {
  return { name, kind: "file", typeCode: "pdf", path: `${folder}\\${name}`, folder, modified };
}
function folder(name: string, parent = DOCS): NameMatch {
  return { name, kind: "folder", path: `${parent}\\${name}`, folder: parent, modified: OCT_14 };
}

/** A search from Documents: running unless `change` says otherwise. */
const snapshot = (change: Partial<SearchSnapshot>): SearchSnapshot => ({
  ...INITIAL_SEARCH,
  open: true,
  root: ROOT,
  running: true,
  parsed: PARSED,
  ...change,
});
const finished = (matches: NameMatch[], done: SearchDone = DONE) => snapshot({ running: false, matches, done });

function fakeActions(): { [K in keyof BrowseActions]: Mock<BrowseActions[K]> } {
  return {
    open: vi.fn<BrowseActions["open"]>(),
    openTyped: vi.fn<BrowseActions["openTyped"]>(),
    openFile: vi.fn<BrowseActions["openFile"]>(),
    showInFolder: vi.fn<BrowseActions["showInFolder"]>(),
    back: vi.fn<BrowseActions["back"]>(),
    forward: vi.fn<BrowseActions["forward"]>(),
    up: vi.fn<BrowseActions["up"]>(),
    reload: vi.fn<BrowseActions["reload"]>(),
    clearPathError: vi.fn<BrowseActions["clearPathError"]>(),
    createFile: vi.fn<BrowseActions["createFile"]>(),
  };
}

const options = () => screen.queryAllByRole("option");
const option = (name: string) => options().find((o) => nameOf(o).textContent === name)!;
const nameOf = (row: HTMLElement) => row.querySelector<HTMLElement>(":scope > div > bdi")!;
const locationOf = (row: HTMLElement) => [...row.querySelectorAll<HTMLElement>("[data-location] > bdi")].map((b) => b.textContent);
const metaOf = (row: HTMLElement) => row.querySelector("p")!.textContent;
const announced = () => screen.getByRole("status").textContent;
const header = () => screen.queryByRole("heading", { level: 2 });
const noticeBanner = () => document.querySelector<HTMLElement>("[data-notices]");
const selectedNames = () => options().filter((o) => o.getAttribute("aria-selected") === "true").map((o) => nameOf(o).textContent);

describe("ResultList", () => {
  it("shows Name matches (n) with one row per match: icon, name, location · date, announced", () => {
    // EARS-01: `report` in a folder with report.pdf, photo.jpg and report-final.docx.
    render(<ResultList snapshot={finished([file("report.pdf"), file("report-final.docx")])} />);
    expect(header()!.textContent).toBe("Name matches (2)");
    expect(header()!.className).toContain("text-group-label");
    expect(header()!.className).toContain("text-muted-foreground");
    const list = screen.getByRole("listbox", { name: "Name matches (2)" });
    expect(within(list).getAllByRole("option").map((o) => nameOf(o).textContent)).toEqual(["report.pdf", "report-final.docx"]);
    const row = option("report.pdf");
    expect(row.firstElementChild!.tagName.toLowerCase()).toBe("svg"); // the type icon comes first
    expect(row.firstElementChild!.getAttribute("aria-hidden")).toBe("true");
    expect(metaOf(row)).toBe("Documents · Oct 14, 2025");
    expect(row.querySelector("p")!.className).toContain("text-body-sm");
    expect(row.querySelector("p")!.className).toContain("text-muted-foreground");
    expect(announced()).toBe("2 name matches found");
    expect(screen.getByRole("status").getAttribute("aria-live")).toBe("polite");
    expect(screen.queryByText(t("search.noMatches"))).toBeNull();
  });

  it("announces one match in the singular, and a folder match has the folder icon", () => {
    render(<ResultList snapshot={finished([folder("reports")])} />);
    expect(header()!.textContent).toBe("Name matches (1)");
    expect(announced()).toBe("1 name match found");
    expect(option("reports").querySelector("svg")!.classList.contains("lucide-folder")).toBe(true);
  });

  it("says each row's type in words for assistive tech, so a folder and a file never sound alike", () => {
    render(<ResultList snapshot={finished([folder("reports"), file("reports", `${DOCS}\\Old`)])} />);
    const types = options().map((o) => o.querySelector(".sr-only")!.textContent!.trim());
    expect(types).toEqual([t("type.folder"), t("type.pdf")]);
    expect(options()[0].textContent).not.toBe(options()[1].textContent);
  });

  it("wraps a long name to two lines, then an ellipsis, with the full name as its tooltip", () => {
    const long = "A very long report name that keeps going and going well past two lines of the list.pdf";
    render(<ResultList snapshot={finished([file(long)])} />);
    const name = nameOf(option(long));
    expect(name.getAttribute("dir")).toBe("auto");
    expect(name.getAttribute("title")).toBe(long);
    expect(name.className).toContain("line-clamp-2");
  });

  it("EARS-03: a finished search with noMatches shows the empty state, muted and never red", () => {
    render(<ResultList snapshot={finished([], NO_MATCHES)} />);
    const sentence = screen.getByText(t("search.noMatches"), { selector: "p" });
    const detail = screen.getByText(t("search.tryDifferentWords"));
    expect(sentence.textContent).toBe("No matching files found");
    expect(detail.textContent).toBe("Try different words.");
    expect(detail.className).toContain("text-muted-foreground");
    const state = sentence.closest("div")!.parentElement!;
    const icon = state.querySelector("svg")!;
    expect(icon.classList.contains("lucide-search")).toBe(true); // the outline magnifier
    expect(icon.getAttribute("class")).toContain("text-muted-foreground");
    expect(state.outerHTML).not.toMatch(/red|destructive/);
    expect(header()).toBeNull();
    expect(options()).toEqual([]);
    // The live region says it, once: the empty state itself is not a second status.
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(announced()).toBe("No matching files found");
  });

  it("streams: the count grows as batches arrive, with no empty state until the end", () => {
    const all = Array.from({ length: 450 }, (_, i) => file(`match ${i}.pdf`));
    const { rerender } = render(<ResultList snapshot={snapshot({})} />);
    // Running, nothing yet: no header, no empty state, nothing announced.
    expect(header()).toBeNull();
    expect(screen.queryByText(t("search.noMatches"))).toBeNull();
    expect(announced()).toBe("");
    for (const n of [200, 400, 450]) {
      rerender(<ResultList snapshot={snapshot({ matches: all.slice(0, n) })} />);
      expect(header()!.textContent).toBe(`Name matches (${n})`);
      expect(options()).toHaveLength(n);
      expect(announced()).toBe("");
    }
    // Arrival order, no sorting.
    expect(nameOf(options()[0]).textContent).toBe("match 0.pdf");
    expect(nameOf(options()[449]).textContent).toBe("match 449.pdf");
    rerender(<ResultList snapshot={finished(all)} />);
    expect(announced()).toBe("450 name matches found");
  });

  it("formats a large count", () => {
    const all = Array.from({ length: 1200 }, (_, i) => file(`m${i}.pdf`));
    render(<ResultList snapshot={finished(all)} />);
    expect(header()!.textContent).toBe("Name matches (1,200)");
    expect(announced()).toBe("1,200 name matches found");
  });

  it("keeps the matches so far when a restart ended the search, and says nothing", () => {
    render(<ResultList snapshot={snapshot({ running: false, matches: [file("report.pdf")], done: null })} />);
    expect(options()).toHaveLength(1);
    expect(screen.queryByText(t("search.noMatches"))).toBeNull();
    expect(announced()).toBe("");
    cleanup();
    // A restart before any match: no empty state either.
    render(<ResultList snapshot={snapshot({ running: false, matches: [], done: null })} />);
    expect(screen.queryByText(t("search.noMatches"))).toBeNull();
    expect(header()).toBeNull();
  });

  it("a stopped search keeps its 30 rows under the notice banner 'Search stopped.', announced", () => {
    const thirty = Array.from({ length: 30 }, (_, i) => file(`report ${i}.pdf`));
    render(<ResultList snapshot={snapshot({ running: false, matches: thirty, stopped: true })} />);
    expect(options()).toHaveLength(30);
    expect(header()!.textContent).toBe("Name matches (30)");
    const banner = noticeBanner()!;
    expect([...banner.querySelectorAll("p")].map((p) => p.textContent)).toEqual(["Search stopped."]);
    expect(banner.className).toContain("bg-notice-info");
    expect(banner.className).toContain("text-notice-info-foreground");
    expect(banner.querySelector("svg")!.classList.contains("lucide-info")).toBe(true);
    expect(banner.querySelector("svg")!.getAttribute("aria-hidden")).toBe("true");
    // Above the header and list, in DOM order.
    expect(banner.compareDocumentPosition(header()!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(announced()).toBe("Search stopped.");
  });

  it("a search stopped before any match shows only the banner, never 'No matching files found'", () => {
    render(<ResultList snapshot={snapshot({ running: false, matches: [], stopped: true })} />);
    expect(noticeBanner()!.textContent).toBe("Search stopped.");
    expect(screen.queryByText(t("search.noMatches"))).toBeNull();
    expect(header()).toBeNull();
    expect(announced()).toBe("Search stopped.");
    cleanup();
    // Even were a noMatches outcome to come with it.
    render(<ResultList snapshot={snapshot({ running: false, matches: [], stopped: true, done: NO_MATCHES })} />);
    expect(screen.queryByText(t("search.noMatches"))).toBeNull();
    expect(announced()).toBe("Search stopped.");
  });

  it("shows the permission notice with the results and announces it after the count", () => {
    render(<ResultList snapshot={finished([file("report.pdf")], PERMISSION_SKIPPED)} />);
    expect(options()).toHaveLength(1);
    expect(noticeBanner()!.textContent).toBe("Some folders couldn't be searched because you don't have permission.");
    expect(noticeBanner()!.compareDocumentPosition(header()!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(announced()).toBe("1 name match found. Some folders couldn't be searched because you don't have permission.");
  });

  it("shows the empty state and the permission banner above it when only denied folders were left", () => {
    render(<ResultList snapshot={finished([], { ...NO_MATCHES, notices: ["permissionSkipped"] })} />);
    const banner = noticeBanner()!;
    const sentence = screen.getByText(t("search.noMatches"), { selector: "p" });
    expect(banner.textContent).toBe(t("search.permissionSkipped"));
    expect(banner.compareDocumentPosition(sentence) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(announced()).toBe("No matching files found. Some folders couldn't be searched because you don't have permission.");
  });

  it("skips a notice code it has no sentence for", () => {
    const unknown = { ...DONE, notices: ["somethingNew", "permissionSkipped"] } as unknown as SearchDone;
    render(<ResultList snapshot={finished([file("report.pdf")], unknown)} />);
    expect([...noticeBanner()!.querySelectorAll("p")].map((p) => p.textContent)).toEqual([t("search.permissionSkipped")]);
    expect(announced()).toBe(`1 name match found. ${t("search.permissionSkipped")}`);
    cleanup();
    // Only unknown codes: no banner at all.
    render(<ResultList snapshot={finished([file("report.pdf")], { ...unknown, notices: ["somethingNew"] } as unknown as SearchDone)} />);
    expect(noticeBanner()).toBeNull();
    expect(announced()).toBe("1 name match found");
  });

  it("shows no banner while running, for a plain finish, or after an error", () => {
    const { rerender } = render(<ResultList snapshot={snapshot({ matches: [file("report.pdf")] })} />);
    expect(noticeBanner()).toBeNull();
    rerender(<ResultList snapshot={finished([file("report.pdf")])} />);
    expect(noticeBanner()).toBeNull();
    rerender(<ResultList snapshot={snapshot({ running: false, error: "folderNotFound" })} />);
    expect(noticeBanner()).toBeNull();
  });

  it("names a deep match's location like the breadcrumb, segment by segment", () => {
    const acme = `${DOCS}\\Projects\\Acme`;
    render(<ResultList snapshot={finished([file("budget.pdf", acme, null), file("report.pdf")])} />);
    const row = option("budget.pdf");
    expect(locationOf(row)).toEqual(["Documents", "Projects", "Acme"]);
    expect(metaOf(row)).toBe("Documents › Projects › Acme"); // no date: no separator
    // Truncated on screen, so the whole line is its tooltip.
    expect(row.querySelector("p")!.getAttribute("title")).toBe("Documents › Projects › Acme");
    expect(locationOf(option("report.pdf"))).toEqual(["Documents"]);
    expect(option("report.pdf").querySelector("p")!.getAttribute("title")).toBe("Documents · Oct 14, 2025");
  });

  it.each([
    ["folderNotFound", "browse.folderNotFound", "lucide-folder-x"],
    ["accessDenied", "browse.accessDenied", "lucide-folder-lock"],
    ["folderUnavailable", "browse.unavailable", "lucide-folder-x"],
  ] as const)("a search error %s shows the browse empty state for it", (code, key, icon) => {
    render(<ResultList snapshot={snapshot({ running: false, error: code })} />);
    const state = screen.getByText(t(key));
    expect(state.closest('[role="status"]')!.querySelector("svg")!.classList.contains(icon)).toBe(true);
    expect(screen.queryByText(t("search.noMatches"))).toBeNull();
    expect(header()).toBeNull();
  });

  it("moves the selection with ↑/↓/Home/End like the browse list, one tab stop", () => {
    render(<ResultList snapshot={finished([file("a.pdf"), file("b.pdf"), file("c.pdf")])} />);
    const tabStops = () => options().filter((o) => o.tabIndex === 0).map((o) => nameOf(o).textContent);
    expect(tabStops()).toEqual(["a.pdf"]);
    expect(selectedNames()).toEqual([]);
    const press = (key: string, init: object = {}) => fireEvent.keyDown(document.activeElement!, { key, ...init });

    act(() => option("a.pdf").focus());
    // The first ↓ selects the focused row; the next moves.
    expect(press("ArrowDown")).toBe(false);
    expect(selectedNames()).toEqual(["a.pdf"]);
    press("ArrowDown");
    expect(selectedNames()).toEqual(["b.pdf"]);
    expect(document.activeElement).toBe(option("b.pdf"));
    expect(tabStops()).toEqual(["b.pdf"]);
    press("End");
    expect(selectedNames()).toEqual(["c.pdf"]);
    press("ArrowDown"); // no wrap
    expect(selectedNames()).toEqual(["c.pdf"]);
    press("Home");
    expect(selectedNames()).toEqual(["a.pdf"]);
    press("ArrowUp");
    expect(selectedNames()).toEqual(["a.pdf"]);
    // A click selects and focuses.
    act(() => fireEvent.click(nameOf(option("c.pdf"))));
    expect(selectedNames()).toEqual(["c.pdf"]);
    expect(document.activeElement).toBe(option("c.pdf"));
  });

  it("forgets the selection when a new search starts", () => {
    const { rerender } = render(<ResultList snapshot={finished([file("a.pdf"), file("b.pdf")])} />);
    act(() => fireEvent.click(option("b.pdf")));
    expect(selectedNames()).toEqual(["b.pdf"]);
    const next = { ...PARSED, id: "q2" };
    rerender(<ResultList snapshot={{ ...finished([file("a.pdf"), file("b.pdf")]), parsed: next }} />);
    expect(selectedNames()).toEqual([]);
  });

  it("opens with Enter or a double-click: a folder in the app, a file in its default app, once per press", () => {
    const actions = fakeActions();
    const acme = `${DOCS}\\Projects`;
    render(<ResultList snapshot={finished([folder("Acme", acme), file("report.pdf")])} actions={actions} />);
    act(() => option("Acme").focus());
    expect(fireEvent.keyDown(option("Acme"), { key: "Enter" })).toBe(false);
    expect(actions.open).toHaveBeenCalledWith(`${acme}\\Acme`);
    fireEvent.keyDown(option("report.pdf"), { key: "Enter" });
    fireEvent.keyDown(option("report.pdf"), { key: "Enter", repeat: true });
    expect(actions.openFile).toHaveBeenCalledTimes(1);
    expect(actions.openFile).toHaveBeenCalledWith(`${DOCS}\\report.pdf`);
    act(() => fireEvent.doubleClick(option("report.pdf")));
    expect(actions.openFile).toHaveBeenCalledTimes(2);
    // Modified Enter does nothing.
    fireEvent.keyDown(option("Acme"), { key: "Enter", ctrlKey: true });
    expect(actions.open).toHaveBeenCalledTimes(1);
    expect(actions.showInFolder).not.toHaveBeenCalled();
  });

  it("shows the row in its folder with Ctrl+Shift+E, by physical key", () => {
    const actions = fakeActions();
    render(<ResultList snapshot={finished([file("report.pdf", `${DOCS}\\Work`)])} actions={actions} />);
    expect(fireEvent.keyDown(option("report.pdf"), { key: "ק", code: "KeyE", ctrlKey: true, shiftKey: true })).toBe(false);
    fireEvent.keyDown(option("report.pdf"), { key: "E", code: "KeyE", ctrlKey: true, shiftKey: true, repeat: true });
    expect(actions.showInFolder.mock.calls).toEqual([[`${DOCS}\\Work\\report.pdf`]]);
  });

  it("offers Open and Show in folder in the row menu, and hands focus back on Esc", () => {
    const actions = fakeActions();
    render(<ResultList snapshot={finished([file("a.pdf"), folder("Acme")])} actions={actions} />);
    // Shift+F10 on a row: it is selected and the menu opens with Open focused.
    act(() => option("Acme").focus());
    act(() => void fireEvent.keyDown(option("Acme"), { key: "F10", shiftKey: true }));
    const menu = screen.getByRole("menu", { name: t("menu.label") });
    expect(within(menu).getAllByRole("menuitem").map((i) => i.textContent)).toEqual(["Open", "Show in folder"]);
    expect(selectedNames()).toEqual(["Acme"]);
    expect(document.activeElement).toBe(within(menu).getByRole("menuitem", { name: "Open" }));
    // Esc closes it, handled, so the window's Esc never also leaves the view.
    expect(fireEvent.keyDown(document.activeElement!, { key: "Escape" })).toBe(false);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(option("Acme"));

    // A right click at the pointer, then Show in folder; then Open.
    act(() => void fireEvent.contextMenu(option("a.pdf"), { button: 2, clientX: 40, clientY: 60 }));
    act(() => fireEvent.click(screen.getByRole("menuitem", { name: "Show in folder" })));
    expect(actions.showInFolder).toHaveBeenCalledWith(`${DOCS}\\a.pdf`);
    act(() => void fireEvent.contextMenu(option("Acme"), { button: 2, clientX: 40, clientY: 60 }));
    act(() => fireEvent.click(screen.getByRole("menuitem", { name: "Open" })));
    expect(actions.open).toHaveBeenCalledWith(`${DOCS}\\Acme`);
  });

  it("Correct Display: every name is one isolate in logical order, every location segment its own, in path order", () => {
    // Searched from a neutral folder, so the location is its name followed by the fixture's segments.
    const top = "C:\\Users\\dana\\Correct Display";
    const root: Place = { path: top, parent: "C:\\Users\\dana", segments: [{ kind: "folder", name: "Correct Display", path: top }] };
    const matches = CORRECT_DISPLAY.map(({ segments, name, kind }) => {
      const where = [top, ...segments].join("\\");
      return kind === "folder" ? folder(name, where) : file(name, where);
    });
    render(<ResultList snapshot={{ ...finished(matches), root }} />);
    expect(options()).toHaveLength(CORRECT_DISPLAY.length);
    for (const [i, { segments, name }] of CORRECT_DISPLAY.entries()) {
      const row = options()[i];
      const names = row.querySelectorAll(":scope > div > bdi");
      expect(names, name).toHaveLength(1);
      expect(names[0].getAttribute("dir")).toBe("auto");
      // The text is the name in logical order, never reordered or split: the extension is last.
      expect(names[0].textContent).toBe(name);
      expect(names[0].childNodes).toHaveLength(1);
      // Each segment is its own isolate, in path order, with "›" outside them.
      const location = row.querySelector("[data-location]")!;
      const isolates = [...location.querySelectorAll("bdi")];
      expect(isolates.map((b) => b.getAttribute("dir"))).toEqual(isolates.map(() => "auto"));
      expect(isolates.map((b) => b.textContent)).toEqual(["Correct Display", ...segments]);
      const between = [...location.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent);
      expect(between).toEqual(segments.map(() => " › "));
      expect(location.textContent).toBe(["Correct Display", ...segments].join(" › "));
    }
    // The fixture covers the names the spec names.
    const names = CORRECT_DISPLAY.map((e) => e.name);
    expect(names).toEqual(expect.arrayContaining(["סיכום ישיבה 3.docx", "Budget תקציב 2025.pdf"]));
    expect(CORRECT_DISPLAY.some((e) => e.segments.join(" › ") === "Documents › התנדבות › Q3")).toBe(true);
  });
});

describe("matchLocation", () => {
  it("starts with the searched folder's breadcrumb names, then the folders below it", () => {
    expect(matchLocation(ROOT, DOCS)).toEqual(["Documents"]);
    expect(matchLocation(ROOT, `${DOCS}\\התנדבות\\Q3`)).toEqual(["Documents", "התנדבות", "Q3"]);
    const drive: Place = { path: "C:\\", parent: null, segments: [{ kind: "drive", letter: "C", label: "OS", path: "C:\\" }] };
    expect(matchLocation(drive, "C:\\")).toEqual(["OS (C:)"]);
    expect(matchLocation(drive, "C:\\Users\\dana")).toEqual(["OS (C:)", "Users", "dana"]);
  });

  it("falls back to the whole path outside the searched folder, or without its place", () => {
    expect(matchLocation(ROOT, `${DOCS} old\\x`)).toEqual(["C:", "Users", "dana", "Documents old", "x"]);
    expect(matchLocation(null, `${DOCS}\\x`)).toEqual(["C:", "Users", "dana", "Documents", "x"]);
  });
});
