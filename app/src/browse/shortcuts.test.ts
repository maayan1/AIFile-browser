// @vitest-environment jsdom
import { cleanup, fireEvent, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BrowseActions } from "./session";
import { shortcutFor, useBrowseShortcuts } from "./shortcuts";

afterEach(cleanup);

type Facts = Parameters<typeof shortcutFor>[0];

const NONE: Facts = {
  key: "",
  code: "",
  altKey: false,
  ctrlKey: false,
  shiftKey: false,
  metaKey: false,
  repeat: false,
  isComposing: false,
  defaultPrevented: false,
};
const press = (change: Partial<Facts>) => shortcutFor({ ...NONE, ...change });

const ARROW_CODES = { ArrowLeft: "ArrowLeft", ArrowRight: "ArrowRight", ArrowUp: "ArrowUp", ArrowDown: "ArrowDown" };
const arrow = (key: keyof typeof ARROW_CODES, change: Partial<Facts> = {}) =>
  press({ key, code: ARROW_CODES[key], ...change });

describe("shortcutFor", () => {
  it("maps Alt+←, Alt+→ and Alt+↑ to back, forward and up", () => {
    expect(arrow("ArrowLeft", { altKey: true })).toBe("back");
    expect(arrow("ArrowRight", { altKey: true })).toBe("forward");
    expect(arrow("ArrowUp", { altKey: true })).toBe("up");
  });

  it("rejects the arrows without Alt alone", () => {
    for (const key of ["ArrowLeft", "ArrowRight", "ArrowUp"] as const) {
      expect(arrow(key), key).toBeNull();
      expect(arrow(key, { altKey: true, shiftKey: true }), `Alt+Shift+${key}`).toBeNull();
      expect(arrow(key, { altKey: true, ctrlKey: true }), `Ctrl+Alt+${key}`).toBeNull();
      expect(arrow(key, { altKey: true, metaKey: true }), `Win+Alt+${key}`).toBeNull();
      expect(arrow(key, { ctrlKey: true }), `Ctrl+${key}`).toBeNull();
      expect(arrow(key, { shiftKey: true }), `Shift+${key}`).toBeNull();
    }
    // Alt+↓ means nothing in File Explorer either.
    expect(arrow("ArrowDown", { altKey: true })).toBeNull();
  });

  it("maps F5 with or without Ctrl or Shift, Ctrl+R and Ctrl+Shift+R to reload", () => {
    expect(press({ key: "F5", code: "F5" })).toBe("reload");
    expect(press({ key: "F5", code: "F5", ctrlKey: true })).toBe("reload");
    expect(press({ key: "F5", code: "F5", shiftKey: true })).toBe("reload");
    expect(press({ key: "F5", code: "F5", ctrlKey: true, shiftKey: true })).toBe("reload");
    expect(press({ key: "r", code: "KeyR", ctrlKey: true })).toBe("reload");
    expect(press({ key: "R", code: "KeyR", ctrlKey: true, shiftKey: true })).toBe("reload");
    // By physical key, so a Hebrew layout's Ctrl+R (ר) works too.
    expect(press({ key: "ר", code: "KeyR", ctrlKey: true })).toBe("reload");
  });

  it("maps the keyboard's own Back, Forward and Refresh keys, without modifiers", () => {
    expect(press({ key: "BrowserBack", code: "BrowserBack" })).toBe("back");
    expect(press({ key: "BrowserForward", code: "BrowserForward" })).toBe("forward");
    expect(press({ key: "BrowserRefresh", code: "BrowserRefresh" })).toBe("reload");
    for (const modifier of ["altKey", "ctrlKey", "shiftKey", "metaKey"]) {
      for (const key of ["BrowserBack", "BrowserForward", "BrowserRefresh"]) {
        expect(press({ key, code: key, [modifier]: true }), `${modifier} ${key}`).toBeNull();
      }
    }
  });

  it("rejects other reload-like keys", () => {
    expect(press({ key: "F5", code: "F5", altKey: true })).toBeNull();
    expect(press({ key: "F5", code: "F5", metaKey: true })).toBeNull();
    expect(press({ key: "r", code: "KeyR" })).toBeNull();
    expect(press({ key: "R", code: "KeyR", shiftKey: true })).toBeNull();
    expect(press({ key: "r", code: "KeyR", ctrlKey: true, altKey: true })).toBeNull();
    expect(press({ key: "r", code: "KeyR", metaKey: true })).toBeNull();
    expect(press({ key: "F4", code: "F4" })).toBeNull();
    expect(press({ key: "d", code: "KeyD", altKey: true })).toBeNull(); // Alt+D is the breadcrumb's
  });

  it("ignores key repeats, IME compositions and events already handled", () => {
    for (const change of [{ repeat: true }, { isComposing: true }, { defaultPrevented: true }]) {
      expect(arrow("ArrowLeft", { altKey: true, ...change })).toBeNull();
      expect(press({ key: "F5", code: "F5", ...change })).toBeNull();
      expect(press({ key: "r", code: "KeyR", ctrlKey: true, ...change })).toBeNull();
    }
  });
});

describe("useBrowseShortcuts", () => {
  function fakeActions() {
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
    } satisfies BrowseActions;
  }

  it("runs each shortcut once from the window and prevents its default", () => {
    const actions = fakeActions();
    renderHook(() => useBrowseShortcuts(actions));
    expect(fireEvent.keyDown(window, { key: "ArrowLeft", altKey: true })).toBe(false);
    expect(fireEvent.keyDown(window, { key: "ArrowRight", altKey: true })).toBe(false);
    expect(fireEvent.keyDown(window, { key: "ArrowUp", altKey: true })).toBe(false);
    expect(fireEvent.keyDown(window, { key: "F5" })).toBe(false);
    expect(fireEvent.keyDown(window, { key: "r", code: "KeyR", ctrlKey: true })).toBe(false);
    expect(actions.back).toHaveBeenCalledTimes(1);
    expect(actions.forward).toHaveBeenCalledTimes(1);
    expect(actions.up).toHaveBeenCalledTimes(1);
    expect(actions.reload).toHaveBeenCalledTimes(2);
  });

  it("stops a held F5's repeats from reloading the page without reloading again", () => {
    const actions = fakeActions();
    renderHook(() => useBrowseShortcuts(actions));
    fireEvent.keyDown(window, { key: "F5" });
    expect(fireEvent.keyDown(window, { key: "F5", repeat: true })).toBe(false);
    expect(actions.reload).toHaveBeenCalledTimes(1);
  });

  it("stops F5 during an IME composition without reloading", () => {
    const actions = fakeActions();
    renderHook(() => useBrowseShortcuts(actions));
    expect(fireEvent.keyDown(window, { key: "F5", isComposing: true })).toBe(false);
    expect(fireEvent.keyDown(window, { key: "ArrowLeft", altKey: true, isComposing: true })).toBe(false);
    expect(actions.reload).not.toHaveBeenCalled();
    expect(actions.back).not.toHaveBeenCalled();
  });

  it("runs the keyboard's Back, Forward and Refresh keys and stops their defaults", () => {
    const actions = fakeActions();
    renderHook(() => useBrowseShortcuts(actions));
    expect(fireEvent.keyDown(window, { key: "BrowserBack" })).toBe(false);
    expect(fireEvent.keyDown(window, { key: "BrowserForward" })).toBe(false);
    expect(fireEvent.keyDown(window, { key: "BrowserRefresh" })).toBe(false);
    expect(actions.back).toHaveBeenCalledTimes(1);
    expect(actions.forward).toHaveBeenCalledTimes(1);
    expect(actions.reload).toHaveBeenCalledTimes(1);
  });

  it("leaves other keys alone, and stops F5 even before the session exists", () => {
    const actions = fakeActions();
    const { rerender, unmount } = renderHook(({ a }: { a?: BrowseActions }) => useBrowseShortcuts(a), {
      initialProps: {} as { a?: BrowseActions },
    });
    expect(fireEvent.keyDown(window, { key: "F5" })).toBe(false);
    expect(fireEvent.keyDown(window, { key: "ArrowLeft" })).toBe(true);
    rerender({ a: actions });
    expect(fireEvent.keyDown(window, { key: "ArrowDown", altKey: true })).toBe(true);
    expect(fireEvent.keyDown(window, { key: "ArrowLeft", altKey: true, shiftKey: true })).toBe(true);
    expect(actions.back).not.toHaveBeenCalled();
    unmount();
    expect(fireEvent.keyDown(window, { key: "F5" })).toBe(true);
  });
});
