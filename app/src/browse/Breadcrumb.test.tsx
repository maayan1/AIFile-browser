// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { t } from "@/i18n/catalog";
import type { FolderListing } from "@/protocol/generated";
import { Breadcrumb } from "./Breadcrumb";
import { INITIAL_SNAPSHOT, type BrowseActions, type BrowseSnapshot, type Place } from "./session";

afterEach(cleanup);

const DOCS = "C:\\Users\\dana\\Documents";
const VOL = `${DOCS}\\Volunteering`;
const MINUTES = `${VOL}\\סיכום ישיבה`;

const LISTING: FolderListing = {
  id: "u1",
  type: "folderListing",
  path: MINUTES,
  parent: VOL,
  segments: [
    { kind: "knownFolder", code: "documents", path: DOCS },
    { kind: "folder", name: "Volunteering", path: VOL },
    { kind: "folder", name: "סיכום ישיבה", path: MINUTES },
  ],
  entries: [],
};

/** A snapshot whose place follows its listing (as the session's does), unless one is given. */
const snapshot = (change: Partial<BrowseSnapshot> = {}): BrowseSnapshot => {
  const listing = "listing" in change ? (change.listing ?? null) : LISTING;
  return { ...INITIAL_SNAPSHOT, listing, place: listing, location: listing?.path ?? null, ...change };
};

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
  };
}

const bar = () => screen.getByRole("group", { name: t("breadcrumb.label") });
const field = () => screen.getByRole<HTMLInputElement>("textbox", { name: t("breadcrumb.field") });
const altD = () => fireEvent.keyDown(window, { key: "d", code: "KeyD", altKey: true });

describe("Breadcrumb", () => {
  it("shows the engine's segments in path order, each a button isolated in <bdi dir=auto>", () => {
    render(<Breadcrumb snapshot={snapshot()} actions={fakeActions()} />);
    const buttons = within(bar()).getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual(["Documents", "Volunteering", "סיכום ישיבה"]);
    for (const button of buttons) {
      const bdi = button.querySelector("bdi")!;
      expect(bdi.getAttribute("dir")).toBe("auto");
      expect(bdi.textContent).toBe(button.textContent);
    }
    expect(buttons[2].getAttribute("aria-current")).toBe("location");
    expect(buttons[0].getAttribute("aria-current")).toBeNull();
    // Two separators, mirrored under rtl and hidden from assistive tech.
    const chevrons = bar().querySelectorAll("svg");
    expect(chevrons.length).toBe(2);
    for (const chevron of chevrons) {
      expect(chevron.getAttribute("aria-hidden")).toBe("true");
      expect(chevron.getAttribute("class")!.split(" ")).toContain("rtl:-scale-x-100");
    }
  });

  it("words drive segments with their label, or Local Disk without one", () => {
    const drive = (label: string | null): FolderListing => ({
      ...LISTING,
      path: "D:\\Work",
      parent: "D:\\",
      segments: [
        { kind: "drive", letter: "D", label, path: "D:\\" },
        { kind: "folder", name: "Work", path: "D:\\Work" },
      ],
    });
    const { rerender } = render(<Breadcrumb snapshot={snapshot({ listing: drive("Data") })} />);
    expect(within(bar()).getAllByRole("button").map((b) => b.textContent)).toEqual(["Data (D:)", "Work"]);
    rerender(<Breadcrumb snapshot={snapshot({ listing: drive(null) })} />);
    expect(within(bar()).getAllByRole("button")[0].textContent).toBe("Local Disk (D:)");
  });

  it("opens an ancestor when its segment is clicked", () => {
    const actions = fakeActions();
    render(<Breadcrumb snapshot={snapshot()} actions={actions} />);
    fireEvent.click(within(bar()).getByRole("button", { name: "Documents" }));
    expect(actions.open).toHaveBeenCalledWith(DOCS);
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("edits the path on Alt+D with the whole path selected, and Enter opens the typed path", () => {
    const actions = fakeActions();
    render(<Breadcrumb snapshot={snapshot()} actions={actions} />);
    altD();
    const input = field();
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe(MINUTES);
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, MINUTES.length]);
    expect(input.getAttribute("dir")).toBe("auto");

    fireEvent.change(input, { target: { value: "c:\\users\\dana\\documents\\" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(actions.openTyped).toHaveBeenCalledWith("c:\\users\\dana\\documents\\");
    expect(actions.open).not.toHaveBeenCalled();
  });

  it("closes the field when the typed folder's listing arrives", () => {
    const actions = fakeActions();
    const { rerender } = render(<Breadcrumb snapshot={snapshot()} actions={actions} />);
    altD();
    fireEvent.change(field(), { target: { value: DOCS } });
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(field()).toBeTruthy();

    const opened: FolderListing = { ...LISTING, id: "u2", path: DOCS, parent: "C:\\Users\\dana", segments: [LISTING.segments[0]] };
    rerender(<Breadcrumb snapshot={snapshot({ listing: opened, location: DOCS })} actions={actions} />);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(within(bar()).getAllByRole("button").map((b) => b.textContent)).toEqual(["Documents"]);
  });

  it("enters edit mode on a click on the empty area, not on a segment", () => {
    const { container } = render(<Breadcrumb snapshot={snapshot()} actions={fakeActions()} />);
    fireEvent.click(within(bar()).getAllByRole("button")[1]);
    expect(screen.queryByRole("textbox")).toBeNull();
    fireEvent.click(container.querySelector("[data-empty-area]")!);
    expect(field().value).toBe(MINUTES);
  });

  it("cancels the edit on Esc and on blur, and gives focus back", () => {
    const actions = fakeActions();
    render(
      <>
        <button type="button">before</button>
        <Breadcrumb snapshot={snapshot()} actions={actions} />
      </>,
    );
    const before = screen.getByRole("button", { name: "before" });
    before.focus();
    altD();
    fireEvent.change(field(), { target: { value: "C:\\elsewhere" } });
    fireEvent.keyDown(field(), { key: "Escape" });
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(document.activeElement).toBe(before);
    expect(actions.openTyped).not.toHaveBeenCalled();

    altD();
    expect(field().value).toBe(MINUTES); // a fresh edit starts from the current path
    act(() => field().blur());
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(actions.openTyped).not.toHaveBeenCalled();
  });

  it("shows a typed path's error under the field and keeps it open", () => {
    const actions = fakeActions();
    const { rerender } = render(<Breadcrumb snapshot={snapshot()} actions={actions} />);
    altD();
    fireEvent.change(field(), { target: { value: "C:\\nope" } });
    fireEvent.keyDown(field(), { key: "Enter" });

    rerender(<Breadcrumb snapshot={snapshot({ pathError: "folderNotFound" })} actions={actions} />);
    const message = screen.getByRole("alert");
    expect(message.textContent).toBe("This folder doesn't exist.");
    expect(field().getAttribute("aria-describedby")).toBe(message.id);
    expect(field().getAttribute("aria-invalid")).toBe("true");
    expect(field().value).toBe("C:\\nope");

    rerender(<Breadcrumb snapshot={snapshot({ pathError: "folderUnavailable" })} actions={actions} />);
    expect(screen.getByRole("alert").textContent).toBe("This folder can't be shown right now.");

    // Typing again clears the error.
    fireEvent.change(field(), { target: { value: "C:\\nope2" } });
    expect(actions.clearPathError).toHaveBeenCalled();
  });

  it("doesn't show an error that arrived after the field was left", () => {
    const actions = fakeActions();
    const { rerender } = render(<Breadcrumb snapshot={snapshot()} actions={actions} />);
    altD();
    fireEvent.change(field(), { target: { value: "\\\\deadserver\\share" } });
    fireEvent.keyDown(field(), { key: "Enter" });
    act(() => field().blur()); // left while the slow path is still loading

    // The failure lands later; the next edit starts clean.
    rerender(<Breadcrumb snapshot={snapshot({ pathError: "folderUnavailable" })} actions={actions} />);
    actions.clearPathError.mockClear();
    altD();
    expect(field().value).toBe(MINUTES);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(field().getAttribute("aria-invalid")).toBeNull();
    expect(actions.clearPathError).toHaveBeenCalled();
  });

  it("listens for Alt+D only, without other modifiers", () => {
    render(<Breadcrumb snapshot={snapshot()} actions={fakeActions()} />);
    fireEvent.keyDown(window, { key: "d", code: "KeyD" });
    fireEvent.keyDown(window, { key: "d", code: "KeyD", altKey: true, ctrlKey: true });
    fireEvent.keyDown(window, { key: "ArrowLeft", code: "ArrowLeft", altKey: true });
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("shows a folder that failed to open, without a place, as its path", () => {
    render(<Breadcrumb snapshot={snapshot({ listing: null, location: `${DOCS}\\Gone`, error: "folderNotFound" })} />);
    expect(within(bar()).queryAllByRole("button")).toEqual([]);
    expect(bar().querySelector("bdi")!.textContent).toBe(`${DOCS}\\Gone`);
  });

  it("keeps the segments of a folder that exists but can't be listed", () => {
    const actions = fakeActions();
    const privatePath = `${DOCS}\\Private`;
    const place: Place = {
      path: privatePath,
      parent: DOCS,
      segments: [LISTING.segments[0], { kind: "folder", name: "Private", path: privatePath }],
    };
    render(
      <Breadcrumb
        snapshot={snapshot({ listing: null, place, location: privatePath, error: "accessDenied" })}
        actions={actions}
      />,
    );
    expect(within(bar()).getAllByRole("button").map((b) => b.textContent)).toEqual(["Documents", "Private"]);
    fireEvent.click(within(bar()).getByRole("button", { name: "Documents" }));
    expect(actions.open).toHaveBeenCalledWith(DOCS);
  });
});
