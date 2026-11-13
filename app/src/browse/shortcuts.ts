import { useEffect } from "react";
import type { BrowseActions } from "./session";

// The window-wide browse shortcuts (UX-DR22), as in File Explorer: Alt+← back, Alt+→ forward,
// Alt+↑ up, and F5 (with or without Ctrl/Shift), Ctrl+R or Ctrl+Shift+R reload the current folder.
// They work from any focus, text fields included. Each one's default is prevented, so WebView2
// never navigates its own history or reloads the page (which would lose the app's Back history).
// The keyboard's own Back, Forward and Refresh keys do the same. Alt+← stays Back under rtl, as in
// File Explorer. Ctrl+E, Ctrl+F and F3 focus the Search Bar (UX-DR5); their default is prevented too, or
// WebView2 opens its own find bar. Alt+D lives in the breadcrumb; Enter, Shift+F10 and Ctrl+Shift+E
// on the rows.

export type Shortcut = "back" | "forward" | "up" | "reload" | "search";

type KeyFacts = Pick<KeyboardEvent, "key" | "code" | "altKey" | "ctrlKey" | "shiftKey" | "metaKey">;
type EventFacts = KeyFacts & Pick<KeyboardEvent, "repeat" | "isComposing" | "defaultPrevented">;

const ARROWS: Record<string, Shortcut> = { ArrowLeft: "back", ArrowRight: "forward", ArrowUp: "up" };
const BROWSER_KEYS: Record<string, Shortcut> = { BrowserBack: "back", BrowserForward: "forward", BrowserRefresh: "reload" };

/** The shortcut these keys name, whether or not the event should run it. */
function shortcutKey({ key, code, altKey, ctrlKey, shiftKey, metaKey }: KeyFacts): Shortcut | null {
  if (metaKey) return null;
  if (!altKey && !ctrlKey && !shiftKey && BROWSER_KEYS[key]) return BROWSER_KEYS[key];
  if (altKey && !ctrlKey && !shiftKey) return ARROWS[key] ?? null;
  if (altKey) return null;
  if (key === "F5") return "reload";
  // F3 searches, as in File Explorer (WebView2 would open its find bar).
  if (key === "F3" && !ctrlKey && !shiftKey) return "search";
  // By physical key, so Ctrl+R, Ctrl+E and Ctrl+F work on any keyboard layout (Hebrew too).
  if (ctrlKey && code === "KeyR") return "reload";
  // Not with Shift: Ctrl+Shift+E is the rows' Show in folder.
  if (ctrlKey && !shiftKey && (code === "KeyE" || code === "KeyF")) return "search";
  return null;
}

/** The shortcut a keydown runs: none for a key repeat, an IME composition or a handled event. */
export function shortcutFor(event: EventFacts): Shortcut | null {
  if (event.repeat || event.isComposing || event.defaultPrevented) return null;
  return shortcutKey(event);
}

/** Listens on the window for the browse shortcuts, and Ctrl+E/F and F3 for `focusSearch`, while mounted. */
export function useBrowseShortcuts(actions?: BrowseActions, focusSearch?: () => void): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !shortcutKey(event)) return;
      const shortcut = shortcutFor(event); // null for a repeat or during an IME composition
      // Stopped even then (a held F5 repeats), or WebView2 reloads the page or opens its find bar.
      event.preventDefault();
      if (shortcut === "search") {
        focusSearch?.();
        return;
      }
      if (!shortcut || !actions) return;
      if (shortcut === "back") actions.back();
      else if (shortcut === "forward") actions.forward();
      else if (shortcut === "up") actions.up();
      else actions.reload();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [actions, focusSearch]);
}
