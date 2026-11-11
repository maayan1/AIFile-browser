import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { t, type CatalogKey } from "@/i18n/catalog";

// The browse list's context menu (FR-3, UX-DR10): "Open" and "Show in folder", nothing else; the
// app never writes, moves, deletes or renames (C-4). It opens with its first item focused; ↑/↓
// move, Enter or a click runs an item, and Esc, Tab or a click outside closes it. Every close
// hands focus back to the row it opened for (`onClose`). It is fixed to the viewport and placed
// with logical properties only, so it mirrors under `dir="rtl"`.

/** Where the menu's start corner goes, in viewport pixels from the top and the inline start. */
export interface MenuPosition {
  top: number;
  inlineStart: number;
}

const ITEMS: { key: CatalogKey; run: "open" | "showInFolder" }[] = [
  { key: "menu.open", run: "open" },
  { key: "menu.showInFolder", run: "showInFolder" },
];

/** Keeps a box of `size` inside a viewport of `room`, starting at `start` where it fits. */
function fit(start: number, size: number, room: number): number {
  return Math.max(0, Math.min(start, room - size));
}

export function RowMenu({
  position,
  onOpen,
  onShowInFolder,
  onClose,
}: {
  position: MenuPosition;
  onOpen: () => void;
  onShowInFolder: () => void;
  onClose: () => void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const [placed, setPlaced] = useState(position);

  // Near the window's end or bottom, the menu is clamped inside the viewport so it stays visible.
  useLayoutEffect(() => {
    const box = menu.current;
    if (!box) return;
    setPlaced({
      top: fit(position.top, box.offsetHeight, window.innerHeight),
      inlineStart: fit(position.inlineStart, box.offsetWidth, window.innerWidth),
    });
  }, [position]);

  useEffect(() => {
    items.current[0]?.focus({ preventScroll: true });
  }, [position]);

  // A click anywhere else, a scroll, or the window losing focus closes it.
  useEffect(() => {
    const outside = (event: Event) => {
      if (!(event.target instanceof Node) || !menu.current?.contains(event.target)) onClose();
    };
    const close = () => onClose();
    document.addEventListener("mousedown", outside, true);
    document.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    return () => {
      document.removeEventListener("mousedown", outside, true);
      document.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
    };
  }, [onClose]);

  function run(which: "open" | "showInFolder") {
    onClose();
    if (which === "open") onOpen();
    else onShowInFolder();
  }

  function move(step: number) {
    const current = items.current.findIndex((item) => item === document.activeElement);
    const next = (current + step + ITEMS.length) % ITEMS.length;
    items.current[next]?.focus();
  }

  return (
    <div
      ref={menu}
      role="menu"
      aria-label={t("menu.label")}
      style={{ top: placed.top, insetInlineStart: placed.inlineStart }}
      // The WebView's own context menu never opens over this one.
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        // Plain arrows only: Alt+↑ goes up a folder from the window.
        const plain = !event.altKey && !event.ctrlKey && !event.metaKey;
        if ((event.key === "ArrowDown" || event.key === "ArrowUp") && plain) {
          event.preventDefault();
          move(event.key === "ArrowDown" ? 1 : -1);
        } else if (event.key === "Escape" || event.key === "Tab") {
          event.preventDefault();
          onClose();
        }
      }}
      className="fixed z-50 min-w-44 rounded-lg border bg-popover p-1 text-[0.875rem] text-popover-foreground shadow-md"
    >
      {ITEMS.map(({ key, run: which }, i) => (
        <button
          key={key}
          ref={(element) => {
            items.current[i] = element;
          }}
          type="button"
          role="menuitem"
          tabIndex={-1}
          onClick={() => run(which)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.stopPropagation();
              run(which);
            }
          }}
          className="block w-full rounded-sm px-3 py-1.5 text-start hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground"
        >
          {t(key)}
        </button>
      ))}
    </div>
  );
}
