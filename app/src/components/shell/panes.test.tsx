// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { INITIAL_SNAPSHOT, type BrowseActions, type BrowseSnapshot, type Place } from "@/browse/session";
import { t } from "@/i18n/catalog";
import type { Locations } from "@/protocol/generated";
import { MainArea, NavPane } from "./panes";
import { TopBar } from "./TopBar";

afterEach(cleanup);

const DOCS = "C:\\Users\\dana\\Documents";
const DESKTOP = "C:\\Users\\dana\\Desktop";

const LOCATIONS: Locations = {
  id: "u2",
  type: "locations",
  knownFolders: [
    { code: "documents", path: DOCS },
    { code: "desktop", path: DESKTOP },
  ],
  drives: [
    { letter: "C", label: null, path: "C:\\" },
    { letter: "D", label: "Data", path: "D:\\" },
  ],
};

const IN_VOLUNTEERING: Place = {
  path: `${DOCS}\\Volunteering`,
  parent: DOCS,
  segments: [
    { kind: "knownFolder", code: "documents", path: DOCS },
    { kind: "folder", name: "Volunteering", path: `${DOCS}\\Volunteering` },
  ],
};
const AT_D: Place = { path: "D:\\", parent: null, segments: [{ kind: "drive", letter: "D", label: "Data", path: "D:\\" }] };
const ON_SHARE: Place = {
  path: "\\\\server\\share\\",
  parent: null,
  segments: [{ kind: "folder", name: "\\\\server\\share", path: "\\\\server\\share\\" }],
};

const snapshot = (place: Place | null, change: Partial<BrowseSnapshot> = {}): BrowseSnapshot => ({
  ...INITIAL_SNAPSHOT,
  place,
  location: place?.path ?? null,
  locations: LOCATIONS,
  ...change,
});

function fakeActions(): BrowseActions {
  return {
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
}

const nav = () => within(screen.getByRole("navigation", { name: t("nav.label") }));
const current = () => nav().queryAllByRole("button").filter((b) => b.getAttribute("aria-current") === "location");

describe("NavPane", () => {
  it("shows Search folders (empty), Quick access and This PC with the engine's entries", () => {
    render(<NavPane browse={snapshot(IN_VOLUNTEERING)} actions={fakeActions()} />);
    const groups = nav().getAllByRole("group");
    expect(groups.map((g) => g.getAttribute("aria-labelledby") && within(g).getByRole("heading").textContent)).toEqual([
      t("nav.searchFolders"),
      t("nav.quickAccess"),
      t("nav.thisPc"),
    ]);
    const names = (group: HTMLElement) => within(group).queryAllByRole("button").map((b) => b.textContent);
    expect(names(groups[0])).toEqual([]);
    expect(names(groups[1])).toEqual(["Documents", "Desktop"]);
    expect(names(groups[2])).toEqual(["Local Disk (C:)", "Data (D:)"]);
  });

  it("highlights the known folder the first breadcrumb segment names", () => {
    render(<NavPane browse={snapshot(IN_VOLUNTEERING)} />);
    expect(current().map((b) => b.textContent)).toEqual(["Documents"]);
  });

  it("highlights the drive at a drive path", () => {
    render(<NavPane browse={snapshot(AT_D)} />);
    expect(current().map((b) => b.textContent)).toEqual(["Data (D:)"]);
  });

  it("highlights nothing when no entry matches", () => {
    render(<NavPane browse={snapshot(ON_SHARE)} />);
    expect(current()).toEqual([]);
  });

  it("opens an entry's path on click", () => {
    const actions = fakeActions();
    render(<NavPane browse={snapshot(IN_VOLUNTEERING)} actions={actions} />);
    fireEvent.click(nav().getByRole("button", { name: "Desktop" }));
    fireEvent.click(nav().getByRole("button", { name: "Data (D:)" }));
    expect(vi.mocked(actions.open).mock.calls).toEqual([[DESKTOP], ["D:\\"]]);
  });
});

describe("TopBar Up", () => {
  const up = () => screen.getByRole<HTMLButtonElement>("button", { name: t("topBar.up") });

  it("is disabled at a drive or share root and enabled below one", () => {
    const actions = fakeActions();
    const { rerender } = render(<TopBar browse={snapshot(AT_D)} actions={actions} />);
    expect(up().disabled).toBe(true);
    rerender(<TopBar browse={snapshot(ON_SHARE)} actions={actions} />);
    expect(up().disabled).toBe(true);
    rerender(<TopBar browse={snapshot(IN_VOLUNTEERING)} actions={actions} />);
    expect(up().disabled).toBe(false);
    fireEvent.click(up());
    expect(actions.up).toHaveBeenCalledTimes(1);
  });

  it("works from a folder that can't be listed when the engine sent its place, not without one", () => {
    const actions = fakeActions();
    const { rerender } = render(
      <TopBar browse={snapshot(IN_VOLUNTEERING, { listing: null, error: "accessDenied" })} actions={actions} />,
    );
    expect(up().disabled).toBe(false);
    rerender(
      <TopBar browse={snapshot(null, { location: `${DOCS}\\Gone`, error: "folderNotFound" })} actions={actions} />,
    );
    expect(up().disabled).toBe(true);
  });
});

describe("MainArea", () => {
  it("opens each folder scrolled to the top and keeps the position on a re-list", () => {
    const { rerender } = render(<MainArea browse={snapshot(IN_VOLUNTEERING)} />);
    const main = screen.getByRole("main");
    main.scrollTop = 480;
    rerender(<MainArea browse={snapshot(IN_VOLUNTEERING, { loading: true })} />);
    expect(main.scrollTop).toBe(480);
    rerender(<MainArea browse={snapshot(AT_D)} />);
    expect(main.scrollTop).toBe(0);
  });

  it("resets the scroll for a new folder before the list scrolls a Show in folder row into view", () => {
    const { rerender } = render(<MainArea browse={snapshot(IN_VOLUNTEERING)} />);
    const main = screen.getByRole("main");
    // The row's scroll lands at 480; a scroll-to-top that ran after it would undo it.
    Element.prototype.scrollIntoView = () => {
      main.scrollTop = 480;
    };
    try {
      const listing = {
        id: "u9",
        type: "folderListing" as const,
        ...AT_D,
        entries: [{ name: "Report.pdf", kind: "file" as const, typeCode: "pdf" as const, size: 1, modified: null }],
        selected: "Report.pdf",
      };
      rerender(<MainArea browse={snapshot(AT_D, { listing })} />);
      expect(main.scrollTop).toBe(480);
    } finally {
      delete (Element.prototype as Partial<Element>).scrollIntoView;
    }
  });
});
