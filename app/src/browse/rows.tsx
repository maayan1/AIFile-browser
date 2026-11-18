import {
  File,
  FileArchive,
  FileCode,
  FileImage,
  FileMusic,
  FilePlay,
  FileSpreadsheet,
  FileText,
  Folder,
  FolderLock,
  FolderX,
  Presentation,
  type LucideIcon,
} from "lucide-react";
import type { KeyboardEvent, MouseEvent } from "react";
import { t, type CatalogKey } from "@/i18n/catalog";
import { folderErrorKey, type DisplayType } from "@/i18n/format";
import type { MenuPosition } from "./RowMenu";

// The pieces a list of files shares, so the browse list and the search results behave alike: the
// type icons, the keys on a row (Enter opens once per press; ↑/↓/Home/End/Space move the selection;
// Shift+F10 or the Menu key opens the row menu; Ctrl+Shift+E runs Show in folder), where a row menu
// goes, and the empty states (an outline icon and a sentence, never red).

export const ICONS: Record<DisplayType, LucideIcon> = {
  folder: Folder,
  pdf: FileText,
  word: FileText,
  excel: FileSpreadsheet,
  powerpoint: Presentation,
  text: FileText,
  markdown: FileCode,
  image: FileImage,
  audio: FileMusic,
  video: FilePlay,
  archive: FileArchive,
  other: File,
};

/** How far a row-anchored menu starts from the row's inline start, past the icon. */
const MENU_INSET = 24;

/** The keys that move the selection within a list. */
export type MoveKey = "ArrowUp" | "ArrowDown" | "Home" | "End" | " ";
const MOVE_KEYS: readonly string[] = ["ArrowUp", "ArrowDown", "Home", "End", " "] satisfies MoveKey[];

function isRtl(element: HTMLElement): boolean {
  return element.closest("[dir]")?.getAttribute("dir") === "rtl";
}

/** At the pointer, for a right click. */
export function atPointer(row: HTMLElement, clientX: number, clientY: number): MenuPosition {
  return { top: clientY, inlineStart: isRtl(row) ? window.innerWidth - clientX : clientX };
}

/** Just below the row's start, for Shift+F10 or the Menu key. */
export function atRow(row: HTMLElement): MenuPosition {
  const box = row.getBoundingClientRect();
  const start = isRtl(row) ? window.innerWidth - box.right : box.left;
  return { top: box.bottom, inlineStart: start + MENU_INSET };
}

/**
 * The row index `key` on row `index` of `count` leads to. Home/End go to the ends; the first ↑/↓
 * selects the focused row (`selected` is false), after that they move the selection (no wrap);
 * Space selects the focused row.
 */
export function moveTarget(index: number, count: number, key: MoveKey, selected: boolean): number {
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  if (key === " " || !selected) return index;
  return Math.min(Math.max(index + (key === "ArrowDown" ? 1 : -1), 0), count - 1);
}

/** What a row's keys and context menu run. */
export interface RowHandlers {
  onOpen: () => void;
  onMove: (key: MoveKey) => void;
  onShowInFolder: () => void;
  onMenu: (row: HTMLElement, position: MenuPosition) => void;
  /** F2, as in File Explorer; given only where the row can be renamed. */
  onRename?: () => void;
}

/** A row's keydown: Enter, the move keys, Shift+F10 or the Menu key, Ctrl+Shift+E, and F2 (with `onRename`). */
export function rowKeyDown(event: KeyboardEvent<HTMLElement>, handlers: RowHandlers): void {
  const plain = !event.altKey && !event.ctrlKey && !event.metaKey;
  if (event.key === "Enter" && plain && !event.shiftKey) {
    event.preventDefault();
    // A held key repeats: open once, not one app window per repeat.
    if (!event.repeat) handlers.onOpen();
  } else if (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey && plain)) {
    event.preventDefault();
    handlers.onMenu(event.currentTarget, atRow(event.currentTarget));
  } else if (MOVE_KEYS.includes(event.key) && plain && !event.shiftKey) {
    // Also keeps the main area from scrolling.
    event.preventDefault();
    handlers.onMove(event.key as MoveKey);
  } else if (event.code === "KeyE" && event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey) {
    // By physical key, so it works on any keyboard layout (Hebrew too).
    event.preventDefault();
    if (!event.repeat) handlers.onShowInFolder();
  } else if (event.key === "F2" && plain && !event.shiftKey && handlers.onRename) {
    event.preventDefault();
    if (!event.repeat) handlers.onRename();
  }
}

/** A row's contextmenu: a right click opens at the pointer, a keyboard-made one (button 0) at the row. */
export function rowContextMenu(event: MouseEvent<HTMLElement>, onMenu: RowHandlers["onMenu"]): void {
  event.preventDefault();
  const row = event.currentTarget;
  onMenu(row, event.button === 2 ? atPointer(row, event.clientX, event.clientY) : atRow(row));
}

/**
 * An outline icon and a sentence, with an optional muted second line. `announce` makes it a
 * status region; a list that has its own live region turns it off.
 */
export function EmptyState({
  icon: Icon,
  text,
  detail,
  announce = true,
}: {
  icon: LucideIcon;
  text: CatalogKey;
  detail?: CatalogKey;
  announce?: boolean;
}) {
  return (
    <div role={announce ? "status" : undefined} className="flex flex-col items-center gap-3 pt-24 text-center">
      <Icon aria-hidden="true" strokeWidth={1.5} className="size-11 text-muted-foreground" />
      <div>
        <p>{t(text)}</p>
        {detail && <p className="mt-1 text-muted-foreground">{t(detail)}</p>}
      </div>
    </div>
  );
}

/** A folder error code's empty state: a locked folder for `accessDenied`, else a crossed-out one. */
export function FolderErrorState({ code }: { code: string }) {
  return <EmptyState icon={code === "accessDenied" ? FolderLock : FolderX} text={folderErrorKey(code)} />;
}
