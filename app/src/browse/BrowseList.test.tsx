// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "@/i18n/catalog";
import type { FolderListing } from "@/protocol/generated";
import { BrowseList } from "./BrowseList";
import { INITIAL_SNAPSHOT, type BrowseSnapshot } from "./session";

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

const snapshot = (change: Partial<BrowseSnapshot>): BrowseSnapshot => ({ ...INITIAL_SNAPSHOT, ...change });
const loaded = (listing: FolderListing = LISTING): BrowseSnapshot => snapshot({ listing, location: listing.path });

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

  it("opens a folder row on double-click or Enter, and files do nothing yet", () => {
    const onOpen = vi.fn();
    render(<BrowseList snapshot={loaded()} onOpen={onOpen} />);
    const row = (name: string) => screen.getByText(name).closest("tr")!;

    fireEvent.doubleClick(row("Photos"));
    expect(onOpen).toHaveBeenLastCalledWith("C:\\Users\\dana\\Documents\\Photos");

    fireEvent.click(row("Photos"));
    fireEvent.keyDown(row("Photos"), { key: "Enter" });
    expect(onOpen).toHaveBeenCalledTimes(2);

    fireEvent.doubleClick(row("סיכום ישיבה 3.docx"));
    fireEvent.click(row("סיכום ישיבה 3.docx"));
    fireEvent.keyDown(row("סיכום ישיבה 3.docx"), { key: "Enter" });
    fireEvent.keyDown(row("Photos"), { key: " " });
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it("starts a new listing with nothing selected", () => {
    const { rerender } = render(<BrowseList snapshot={loaded()} />);
    fireEvent.click(screen.getByText("Photos").closest("tr")!);
    rerender(<BrowseList snapshot={loaded({ ...LISTING, id: "u2" })} />);
    expect(screen.getByText("Photos").closest("tr")!.getAttribute("aria-selected")).toBe("false");
  });
});
