// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { t } from "@/i18n/catalog";
import type { FolderListing } from "@/protocol/generated";
import { BrowseList } from "./BrowseList";
import { INITIAL_SNAPSHOT, type BrowseActions, type BrowseSnapshot } from "./session";

afterEach(cleanup);

const LISTING: FolderListing = {
  id: "u1",
  type: "folderListing",
  path: "C:\\Users\\dana\\Documents",
  parent: "C:\\Users\\dana",
  segments: [{ kind: "knownFolder", code: "documents", path: "C:\\Users\\dana\\Documents" }],
  entries: [
    { name: "סיכום ישיבה 3.docx", kind: "file", typeCode: "word", size: 38_912, modified: "2025-10-14T12:00:00+00:00" },
    { name: "Photos", kind: "folder", modified: "2025-10-20T12:00:00+00:00" },
    { name: "Budget תקציב.pdf", kind: "file", typeCode: "pdf", size: 2.4 * 1024 * 1024, modified: "2025-10-02T12:00:00+00:00" },
  ],
};

const DOCS = LISTING.path;

const snapshot = (change: Partial<BrowseSnapshot>): BrowseSnapshot => ({ ...INITIAL_SNAPSHOT, ...change });
const loaded = (listing: FolderListing = LISTING): BrowseSnapshot => snapshot({ listing, location: listing.path });
const row = (name: string) => screen.getByText(name).closest("tr")!;
const selectedNames = () =>
  screen
    .getAllByRole("row")
    .filter((r) => r.getAttribute("aria-selected") === "true")
    .map((r) => within(r).getAllByRole("cell")[0].textContent);

function fakeActions(): { [K in keyof BrowseActions]: Mock<BrowseActions[K]> } {
  return {
    open: vi.fn<BrowseActions["open"]>(),
    openTyped: vi.fn<BrowseActions["openTyped"]>(),
    openFile: vi.fn<BrowseActions["openFile"]>(),
    showInFolder: vi.fn<BrowseActions["showInFolder"]>(),
    back: vi.fn<BrowseActions["back"]>(),
    forward: vi.fn<BrowseActions["forward"]>(),
    up: vi.fn<BrowseActions["up"]>(),
    clearPathError: vi.fn<BrowseActions["clearPathError"]>(),
  };
}

function rowNames(): string[] {
  const [, ...rows] = screen.getAllByRole("row");
  return rows.map((row) => within(row).getAllByRole("cell")[0].textContent ?? "");
}

const header = (key: "column.name" | "column.type" | "column.size" | "column.modified") =>
  screen.getByRole("columnheader", { name: t(key) });

describe("BrowseList", () => {
  it("shows the four catalog-worded columns and the formatted cells", () => {
    render(<BrowseList snapshot={loaded()} />);
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Name",
      "Type",
      "Size",
      "Modified",
    ]);
    const cells = (name: string) =>
      within(screen.getByText(name).closest("tr")!)
        .getAllByRole("cell")
        .map((c) => c.textContent);
    expect(cells("סיכום ישיבה 3.docx")).toEqual(["סיכום ישיבה 3.docx", "Word document", "38 KB", "Oct 14, 2025"]);
    expect(cells("Budget תקציב.pdf")).toEqual(["Budget תקציב.pdf", "PDF document", "2.4 MB", "Oct 2, 2025"]);
    expect(cells("Photos")).toEqual(["Photos", "File folder", "", "Oct 20, 2025"]);
  });

  it("isolates each name in a <bdi dir=auto>", () => {
    render(<BrowseList snapshot={loaded()} />);
    for (const name of ["סיכום ישיבה 3.docx", "Budget תקציב.pdf", "Photos"]) {
      const el = screen.getByText(name);
      expect(el.tagName).toBe("BDI");
      expect(el.getAttribute("dir")).toBe("auto");
      expect(el.textContent).toBe(name); // the extension stays at the end of the logical name
    }
  });

  it("sorts by name ascending with folders first, and a header click sorts and reverses", () => {
    render(<BrowseList snapshot={loaded()} />);
    expect(header("column.name").getAttribute("aria-sort")).toBe("ascending");
    expect(header("column.size").getAttribute("aria-sort")).toBe("none");
    expect(rowNames()).toEqual(["Photos", "Budget תקציב.pdf", "סיכום ישיבה 3.docx"]);

    fireEvent.click(within(header("column.size")).getByRole("button"));
    expect(header("column.size").getAttribute("aria-sort")).toBe("ascending");
    expect(header("column.name").getAttribute("aria-sort")).toBe("none");
    expect(rowNames()).toEqual(["Photos", "סיכום ישיבה 3.docx", "Budget תקציב.pdf"]);

    fireEvent.click(within(header("column.size")).getByRole("button"));
    expect(header("column.size").getAttribute("aria-sort")).toBe("descending");
    expect(rowNames()).toEqual(["Photos", "Budget תקציב.pdf", "סיכום ישיבה 3.docx"]);

    fireEvent.click(within(header("column.name")).getByRole("button"));
    fireEvent.click(within(header("column.name")).getByRole("button"));
    expect(header("column.name").getAttribute("aria-sort")).toBe("descending");
    expect(rowNames()).toEqual(["Photos", "סיכום ישיבה 3.docx", "Budget תקציב.pdf"]);
  });

  it("shows busy skeleton rows until the first listing arrives", () => {
    const { container, rerender } = render(<BrowseList snapshot={snapshot({ loading: true })} />);
    expect(screen.getByRole("table").getAttribute("aria-busy")).toBe("true");
    expect(container.querySelectorAll("[data-skeleton]").length).toBeGreaterThan(0);
    expect(screen.getByRole("columnheader", { name: t("column.name") })).toBeTruthy();

    rerender(<BrowseList snapshot={loaded()} />);
    expect(screen.getByRole("table").getAttribute("aria-busy")).toBe("false");
    expect(container.querySelectorAll("[data-skeleton]").length).toBe(0);
  });

  it("replaces an error with busy skeleton rows while a new listing loads", () => {
    const { container } = render(<BrowseList snapshot={snapshot({ error: "accessDenied", loading: true })} />);
    expect(screen.queryByText(t("browse.accessDenied"))).toBeNull();
    expect(screen.getByRole("table").getAttribute("aria-busy")).toBe("true");
    expect(container.querySelectorAll("[data-skeleton]").length).toBeGreaterThan(0);
  });

  it("shows skeleton rows without a snapshot", () => {
    const { container } = render(<BrowseList />);
    expect(screen.getByRole("table").getAttribute("aria-busy")).toBe("true");
    expect(container.querySelectorAll("[data-skeleton]").length).toBeGreaterThan(0);
  });

  it("shows the empty state for a folder with nothing to list", () => {
    const { container } = render(<BrowseList snapshot={loaded({ ...LISTING, entries: [] })} />);
    expect(screen.getByRole("status").textContent).toBe(t("browse.empty"));
    expect(container.querySelector("svg")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it.each([
    ["folderNotFound", "This folder doesn't exist."],
    ["accessDenied", "You don't have permission to open this folder."],
    ["folderUnavailable", "This folder can't be shown right now."],
    ["invalidRequest", t("browse.unavailable")],
  ])("shows the %s sentence in the empty state", (code, text) => {
    render(<BrowseList snapshot={snapshot({ error: code })} />);
    expect(screen.getByRole("status").textContent).toBe(text);
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("selects one row at a time on click, focuses it and marks it", () => {
    render(<BrowseList snapshot={loaded()} />);
    const row = (name: string) => screen.getByText(name).closest("tr")!;
    expect(screen.getAllByRole("row").filter((r) => r.getAttribute("aria-selected") === "true")).toEqual([]);

    fireEvent.click(row("Photos"));
    expect(row("Photos").getAttribute("aria-selected")).toBe("true");
    expect(row("Photos").className).toContain("bg-selection");
    expect(row("Photos").tabIndex).toBe(0);
    expect(document.activeElement).toBe(row("Photos"));

    fireEvent.click(row("Budget תקציב.pdf"));
    expect(row("Photos").getAttribute("aria-selected")).toBe("false");
    expect(row("Photos").className).not.toContain("bg-selection");
    expect(row("Photos").tabIndex).toBe(-1);
    expect(row("Budget תקציב.pdf").getAttribute("aria-selected")).toBe("true");
  });

  it("opens a folder row in the app and a file row in its default app, on double-click or Enter", () => {
    const actions = fakeActions();
    render(<BrowseList snapshot={loaded()} actions={actions} />);

    fireEvent.doubleClick(row("Photos"));
    expect(actions.open).toHaveBeenLastCalledWith(`${DOCS}\\Photos`);
    fireEvent.click(row("Photos"));
    fireEvent.keyDown(row("Photos"), { key: "Enter" });
    expect(actions.open).toHaveBeenCalledTimes(2);

    fireEvent.doubleClick(row("סיכום ישיבה 3.docx"));
    expect(actions.openFile).toHaveBeenLastCalledWith(`${DOCS}\\סיכום ישיבה 3.docx`);
    fireEvent.click(row("Budget תקציב.pdf"));
    fireEvent.keyDown(row("Budget תקציב.pdf"), { key: "Enter" });
    expect(actions.openFile).toHaveBeenLastCalledWith(`${DOCS}\\Budget תקציב.pdf`);
    expect(actions.openFile).toHaveBeenCalledTimes(2);

    // Other keys, and Enter with a modifier, open nothing.
    fireEvent.keyDown(row("Photos"), { key: " " });
    fireEvent.keyDown(row("Photos"), { key: "Enter", ctrlKey: true });
    expect(actions.open).toHaveBeenCalledTimes(2);
    expect(actions.openFile).toHaveBeenCalledTimes(2);
    expect(actions.showInFolder).not.toHaveBeenCalled();
  });

  it("shows the row Show in folder named as selected, scrolled into view and focused", () => {
    const scrolled = vi.fn();
    Element.prototype.scrollIntoView = scrolled;
    try {
      const { rerender } = render(<BrowseList snapshot={loaded({ ...LISTING, selected: "Budget תקציב.pdf" })} />);
      expect(selectedNames()).toEqual(["Budget תקציב.pdf"]);
      expect(row("Budget תקציב.pdf").tabIndex).toBe(0);
      expect(document.activeElement).toBe(row("Budget תקציב.pdf"));
      expect(scrolled.mock.contexts).toEqual([row("Budget תקציב.pdf")]);

      // Until the user selects another row in that listing.
      fireEvent.click(row("Photos"));
      expect(selectedNames()).toEqual(["Photos"]);

      // A listing without `selected` selects nothing and scrolls nothing.
      rerender(<BrowseList snapshot={loaded({ ...LISTING, id: "u3" })} />);
      expect(selectedNames()).toEqual([]);
      expect(scrolled).toHaveBeenCalledTimes(1);
    } finally {
      delete (Element.prototype as Partial<Element>).scrollIntoView;
    }
  });

  it("acts once for a held Enter or Ctrl+Shift+E, ignoring the key's repeats", () => {
    const actions = fakeActions();
    render(<BrowseList snapshot={loaded()} actions={actions} />);
    const file = row("Budget תקציב.pdf");
    fireEvent.click(file);
    fireEvent.keyDown(file, { key: "Enter" });
    fireEvent.keyDown(file, { key: "Enter", repeat: true });
    fireEvent.keyDown(file, { key: "Enter", repeat: true });
    expect(actions.openFile).toHaveBeenCalledTimes(1);
    const showKey = { key: "E", code: "KeyE", ctrlKey: true, shiftKey: true };
    fireEvent.keyDown(file, showKey);
    fireEvent.keyDown(file, { ...showKey, repeat: true });
    expect(actions.showInFolder).toHaveBeenCalledTimes(1);
  });

  it("runs Show in folder for the row on Ctrl+Shift+E", () => {
    const actions = fakeActions();
    render(<BrowseList snapshot={loaded()} actions={actions} />);
    fireEvent.click(row("Budget תקציב.pdf"));
    fireEvent.keyDown(row("Budget תקציב.pdf"), { key: "E", code: "KeyE", ctrlKey: true, shiftKey: true });
    expect(actions.showInFolder).toHaveBeenCalledWith(`${DOCS}\\Budget תקציב.pdf`);
    // Without Shift, or with Alt too, it does nothing.
    fireEvent.keyDown(row("Budget תקציב.pdf"), { key: "e", code: "KeyE", ctrlKey: true });
    fireEvent.keyDown(row("Budget תקציב.pdf"), { key: "E", code: "KeyE", ctrlKey: true, shiftKey: true, altKey: true });
    expect(actions.showInFolder).toHaveBeenCalledTimes(1);
  });

  it("starts a new listing with nothing selected", () => {
    const { rerender } = render(<BrowseList snapshot={loaded()} />);
    fireEvent.click(screen.getByText("Photos").closest("tr")!);
    rerender(<BrowseList snapshot={loaded({ ...LISTING, id: "u2" })} />);
    expect(screen.getByText("Photos").closest("tr")!.getAttribute("aria-selected")).toBe("false");
  });
});
