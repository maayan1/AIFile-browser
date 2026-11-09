// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { t } from "@/i18n/catalog";
import type { FolderListing } from "@/protocol/generated";
import { BrowseList } from "./BrowseList";
import type { BrowseSnapshot } from "./session";

afterEach(cleanup);

const LISTING: FolderListing = {
  id: "u1",
  type: "folderListing",
  path: "C:\\Users\\dana\\Documents",
  entries: [
    { name: "סיכום ישיבה 3.docx", kind: "file", typeCode: "word", size: 38_912, modified: "2025-10-14T12:00:00+00:00" },
    { name: "Photos", kind: "folder", modified: "2025-10-20T12:00:00+00:00" },
    { name: "Budget תקציב.pdf", kind: "file", typeCode: "pdf", size: 2.4 * 1024 * 1024, modified: "2025-10-02T12:00:00+00:00" },
  ],
};

const loaded = (listing: FolderListing = LISTING): BrowseSnapshot => ({ listing, error: null, loading: false });

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
    const { container, rerender } = render(<BrowseList snapshot={{ listing: null, error: null, loading: true }} />);
    expect(screen.getByRole("table").getAttribute("aria-busy")).toBe("true");
    expect(container.querySelectorAll("[data-skeleton]").length).toBeGreaterThan(0);
    expect(screen.getByRole("columnheader", { name: t("column.name") })).toBeTruthy();

    rerender(<BrowseList snapshot={loaded()} />);
    expect(screen.getByRole("table").getAttribute("aria-busy")).toBe("false");
    expect(container.querySelectorAll("[data-skeleton]").length).toBe(0);
  });

  it("replaces an error with busy skeleton rows while a new listing loads", () => {
    const { container } = render(<BrowseList snapshot={{ listing: null, error: "accessDenied", loading: true }} />);
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
    ["invalidRequest", t("browse.unavailable")],
  ])("shows the %s sentence in the empty state", (code, text) => {
    render(<BrowseList snapshot={{ listing: null, error: code, loading: false }} />);
    expect(screen.getByRole("status").textContent).toBe(text);
    expect(screen.queryByRole("table")).toBeNull();
  });
});
