// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { INITIAL_SNAPSHOT, type BrowseActions, type BrowseSnapshot } from "@/browse/session";
import { catalog, t } from "@/i18n/catalog";
import type { FolderListing } from "@/protocol/generated";
import { AppShell } from "./AppShell";

// Vitest runs without globals, so testing-library can't clean up on its own.
afterEach(cleanup);

describe("AppShell", () => {
  it("has every area as a labeled landmark, in tab order", () => {
    render(<AppShell bannerVisible={false} />);
    const areas = [
      screen.getByRole("banner", { name: t("topBar.label") }),
      screen.getByRole("group", { name: t("filter.label") }),
      screen.getByRole("navigation", { name: t("nav.label") }),
      screen.getByRole("main", { name: t("main.label") }),
      screen.getByRole("complementary", { name: t("preview.label") }),
      screen.getByRole("contentinfo", { name: t("status.label") }),
    ];
    for (let i = 1; i < areas.length; i++) {
      expect(areas[i - 1].compareDocumentPosition(areas[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it("draws the later-story controls as inert placeholders", () => {
    render(<AppShell bannerVisible={false} />);
    for (const key of ["topBar.back", "topBar.forward", "topBar.up", "topBar.settings"] as const) {
      const button = screen.getByRole<HTMLButtonElement>("button", { name: t(key) });
      expect(button.disabled).toBe(true);
      expect(button.title).toBe(t(key));
    }
    // Scoped to the filter bar: the browse list also has a "Type" column header button.
    const filters = within(screen.getByRole("group", { name: t("filter.label") }));
    for (const key of ["filter.date", "filter.type"] as const) {
      expect(filters.getByRole<HTMLButtonElement>("button", { name: t(key) }).disabled).toBe(true);
    }
    const search = screen.getByRole("textbox", { name: t("search.label") });
    expect(search.getAttribute("placeholder")).toBe(t("search.placeholder"));
    expect(search.getAttribute("dir")).toBe("auto");
    expect(screen.getByText(t("preview.empty"))).toBeTruthy();
  });

  it("tabs through the areas in order, with one row tab stop and no positive tabIndex", () => {
    const docs = "C:\\Users\\dana\\Documents";
    const listing: FolderListing = {
      id: "u1",
      type: "folderListing",
      path: docs,
      parent: "C:\\Users\\dana",
      segments: [{ kind: "knownFolder", code: "documents", path: docs }],
      entries: [
        { name: "Photos", kind: "folder", modified: null },
        { name: "notes.txt", kind: "file", typeCode: "text", size: 10, modified: null },
      ],
    };
    const browse: BrowseSnapshot = {
      ...INITIAL_SNAPSHOT,
      listing,
      place: listing,
      location: docs,
      canBack: true,
      locations: { id: "u2", type: "locations", knownFolders: [{ code: "documents", path: docs }], drives: [] },
    };
    const actions: BrowseActions = {
      open: vi.fn(),
      openTyped: vi.fn(),
      openFile: vi.fn(),
      showInFolder: vi.fn(),
      back: vi.fn(),
      forward: vi.fn(),
      up: vi.fn(),
      reload: vi.fn(),
      clearPathError: vi.fn(),
    };
    const { container } = render(<AppShell bannerVisible={false} browse={browse} actions={actions} />);

    const areas = [
      screen.getByRole("banner", { name: t("topBar.label") }),
      screen.getByRole("group", { name: t("filter.label") }),
      screen.getByRole("navigation", { name: t("nav.label") }),
      screen.getByRole("main", { name: t("main.label") }),
      screen.getByRole("complementary", { name: t("preview.label") }),
      screen.getByRole("contentinfo", { name: t("status.label") }),
    ];
    const focusable = [...container.querySelectorAll<HTMLElement>("a[href], button, input, select, textarea, [tabindex]")];
    const tabbable = focusable.filter((el) => el.tabIndex >= 0 && !(el as HTMLButtonElement).disabled);
    expect(focusable.filter((el) => el.tabIndex > 0)).toEqual([]);

    // DOM order is the tab order, and it never goes back to an earlier area.
    const areaOf = (el: HTMLElement) => areas.findIndex((area) => area.contains(el));
    const order = tabbable.map(areaOf);
    expect(order.every((area) => area >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    // The filter chips are disabled and the empty Preview Panel and status bar have no stops.
    expect(new Set(order)).toEqual(new Set([0, 2, 3]));

    // In the main list: the four sort headers, then exactly one row.
    const main = tabbable.filter((el) => areaOf(el) === 3);
    expect(main.map((el) => el.tagName)).toEqual(["BUTTON", "BUTTON", "BUTTON", "BUTTON", "TR"]);
    expect(within(main[4]).getByText("Photos")).toBeTruthy();
  });

  it("shows the engine banner as an alert only while it is visible", () => {
    const { rerender } = render(<AppShell bannerVisible={true} />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe(t("engine.restarting"));
    // Under the filter bar, above the panes.
    const filters = screen.getByRole("group", { name: t("filter.label") });
    const nav = screen.getByRole("navigation", { name: t("nav.label") });
    expect(filters.compareDocumentPosition(alert) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(alert.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    rerender(<AppShell bannerVisible={false} />);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("mirrors only the directional icons under rtl", () => {
    render(<AppShell bannerVisible={false} />);
    const mirrored = (key: "topBar.back" | "topBar.forward" | "topBar.up" | "topBar.settings") =>
      screen.getByRole("button", { name: t(key) }).querySelector("svg")!.getAttribute("class")!.split(" ").includes("rtl:-scale-x-100");
    expect(mirrored("topBar.back")).toBe(true);
    expect(mirrored("topBar.forward")).toBe(true);
    expect(mirrored("topBar.up")).toBe(false);
    expect(mirrored("topBar.settings")).toBe(false);
  });

  it("shows only catalog text", () => {
    const { container } = render(<AppShell bannerVisible={true} />);
    const values = new Set<string>(Object.values(catalog));
    const shown: string[] = [];

    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent?.trim();
      if (text) shown.push(text);
    }
    const attrs = ["aria-label", "placeholder", "title", "alt", "aria-description", "aria-roledescription", "aria-valuetext", "value"];
    for (const el of container.querySelectorAll(attrs.map((a) => `[${a}]`).join(", "))) {
      for (const attr of attrs) {
        const value = el.getAttribute(attr);
        if (value) shown.push(value);
      }
    }

    expect(shown.length).toBeGreaterThan(0);
    for (const text of shown) expect(values, `"${text}" is not from the catalog`).toContain(text);
  });
});
