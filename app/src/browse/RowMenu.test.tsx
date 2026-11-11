// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { t } from "@/i18n/catalog";
import type { FolderListing } from "@/protocol/generated";
import { BrowseList } from "./BrowseList";
import { INITIAL_SNAPSHOT, type BrowseActions } from "./session";

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("dir");
});

const DOCS = "C:\\Users\\dana\\Documents";
const LISTING: FolderListing = {
  id: "u1",
  type: "folderListing",
  path: DOCS,
  parent: "C:\\Users\\dana",
  segments: [{ kind: "knownFolder", code: "documents", path: DOCS }],
  entries: [
    { name: "Photos", kind: "folder", modified: null },
    { name: "Budget תקציב.pdf", kind: "file", typeCode: "pdf", size: 1, modified: null },
  ],
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

function setup() {
  const actions = fakeActions();
  render(<BrowseList snapshot={{ ...INITIAL_SNAPSHOT, listing: LISTING, location: DOCS }} actions={actions} />);
  return actions;
}

const row = (name: string) => screen.getByText(name).closest("tr")!;
const menu = () => screen.getByRole("menu", { name: t("menu.label") });
const items = () => within(menu()).getAllByRole("menuitem");

/** The menu's inline styles: its top and inline-start offsets, as set. */
function placement() {
  const style = menu().style;
  return { top: style.top, inlineStart: style.insetInlineStart };
}

describe("RowMenu", () => {
  it("opens at the pointer on a right-click with exactly Open and Show in folder, and selects the row", () => {
    setup();
    fireEvent.contextMenu(row("Budget תקציב.pdf"), { button: 2, clientX: 120, clientY: 300 });
    expect(items().map((item) => item.textContent)).toEqual([t("menu.open"), t("menu.showInFolder")]);
    expect(row("Budget תקציב.pdf").getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(items()[0]);
    expect(placement()).toEqual({ top: "300px", inlineStart: "120px" });
    expect(menu().className).toContain("rounded-lg");
    expect(menu().className).toContain("shadow-md");
  });

  it("measures a right-click from the inline start under dir=rtl", () => {
    document.documentElement.setAttribute("dir", "rtl");
    setup();
    fireEvent.contextMenu(row("Photos"), { button: 2, clientX: 120, clientY: 300 });
    expect(placement()).toEqual({ top: "300px", inlineStart: `${window.innerWidth - 120}px` });
  });

  it.each([
    ["Shift+F10", { key: "F10", shiftKey: true }],
    ["the Menu key", { key: "ContextMenu" }],
  ])("opens at the row on %s", (_name, key) => {
    setup();
    const target = row("Photos");
    target.getBoundingClientRect = () => ({ left: 10, right: 610, top: 40, bottom: 76 }) as DOMRect;
    fireEvent.click(target);
    fireEvent.keyDown(target, key);
    expect(items()).toHaveLength(2);
    expect(document.activeElement).toBe(items()[0]);
    expect(placement()).toEqual({ top: "76px", inlineStart: "34px" });
  });

  it("moves with ↑/↓, wrapping, and Enter runs the focused item", () => {
    const actions = setup();
    fireEvent.contextMenu(row("Budget תקציב.pdf"), { button: 2, clientX: 1, clientY: 1 });
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(items()[1]);
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(items()[0]);
    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
    expect(document.activeElement).toBe(items()[1]);
    fireEvent.keyDown(document.activeElement!, { key: "Enter" });
    expect(actions.showInFolder).toHaveBeenCalledWith(`${DOCS}\\Budget תקציב.pdf`);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(row("Budget תקציב.pdf"));
  });

  it("leaves Alt+↑ and other modified arrows to the window", () => {
    setup();
    fireEvent.contextMenu(row("Budget תקציב.pdf"), { button: 2, clientX: 1, clientY: 1 });
    const first = items()[0];
    expect(document.activeElement).toBe(first);
    expect(fireEvent.keyDown(first, { key: "ArrowUp", altKey: true })).toBe(true);
    expect(fireEvent.keyDown(first, { key: "ArrowDown", ctrlKey: true })).toBe(true);
    expect(fireEvent.keyDown(first, { key: "ArrowDown", metaKey: true })).toBe(true);
    expect(document.activeElement).toBe(first);
  });

  it("runs Open on click: a file in its default app, a folder in the app", () => {
    const actions = setup();
    fireEvent.contextMenu(row("Budget תקציב.pdf"), { button: 2, clientX: 1, clientY: 1 });
    fireEvent.click(items()[0]);
    expect(actions.openFile).toHaveBeenCalledWith(`${DOCS}\\Budget תקציב.pdf`);
    expect(screen.queryByRole("menu")).toBeNull();

    fireEvent.contextMenu(row("Photos"), { button: 2, clientX: 1, clientY: 1 });
    fireEvent.keyDown(items()[0], { key: "Enter" });
    expect(actions.open).toHaveBeenCalledWith(`${DOCS}\\Photos`);
    expect(actions.openFile).toHaveBeenCalledTimes(1);
  });

  it("closes on Esc or a click outside and returns focus to the row", () => {
    const actions = setup();
    fireEvent.contextMenu(row("Photos"), { button: 2, clientX: 1, clientY: 1 });
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(row("Photos"));

    fireEvent.keyDown(row("Photos"), { key: "ContextMenu" });
    fireEvent.mouseDown(items()[1]); // inside: stays open
    expect(screen.getByRole("menu")).toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(row("Photos"));
    expect(Object.values(actions).every((action) => action.mock.calls.length === 0)).toBe(true);
  });

  it("closes on Tab or when the window loses focus, and returns focus to the row", () => {
    setup();
    fireEvent.contextMenu(row("Photos"), { button: 2, clientX: 1, clientY: 1 });
    fireEvent.keyDown(document.activeElement!, { key: "Tab" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(row("Photos"));

    fireEvent.contextMenu(row("Budget תקציב.pdf"), { button: 2, clientX: 1, clientY: 1 });
    expect(document.activeElement).toBe(items()[0]);
    fireEvent.blur(window);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(row("Budget תקציב.pdf"));
  });

  it("keeps the WebView's own context menu away from rows and the menu", () => {
    setup();
    // fireEvent returns false when a handler called preventDefault.
    expect(fireEvent.contextMenu(row("Photos"), { button: 2 })).toBe(false);
    expect(fireEvent.contextMenu(items()[0], { button: 2 })).toBe(false);
  });
});
