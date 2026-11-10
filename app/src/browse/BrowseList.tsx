import {
  ChevronDown,
  ChevronUp,
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
  FolderOpen,
  FolderX,
  Presentation,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { t, type CatalogKey } from "@/i18n/catalog";
import {
  displayType,
  folderErrorKey,
  formatDate,
  formatSize,
  typeLabel,
  type DisplayType,
  type Entry,
} from "@/i18n/format";
import { cn } from "@/lib/utils";
import type { FolderListing } from "@/protocol/generated";
import { RowMenu, type MenuPosition } from "./RowMenu";
import { childPath, type BrowseActions, type BrowseSnapshot } from "./session";
import { DEFAULT_SORT, nextSort, sortEntries, type SortColumn, type SortOrder } from "./sort";

// The browse list (FR-1, FR-3): a table with a sticky, sortable header. A click selects one row
// and focuses it; double-click or Enter opens it: a folder in the app, a file in its Windows
// default app. A right-click, Shift+F10 or the Menu key selects the row and opens its menu (Open,
// Show in folder); Ctrl+Shift+E runs Show in folder. Focus and selection are separate, as in File
// Explorer (UX-DR22): the list's one tab stop is the selected row, or else the first; ↑/↓ select the
// focused row, then move the selection and focus (no wrap); Home/End go to the ends; Space selects.
// A new folder's listing selects nothing and, when focus was on the page or in the list, focuses its
// first row; a re-list of the same folder (F5) keeps the selection. After Show in folder the
// listing names the item to select, and that row is scrolled into view and focused. Names are
// isolated with <bdi dir="auto"> so a Hebrew or mixed name reads in its own direction with the
// extension at its end, while the icon stays at the row's start. Logical properties only.

const ICONS: Record<DisplayType, LucideIcon> = {
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

const COLUMNS: { column: SortColumn; label: CatalogKey; className: string }[] = [
  { column: "name", label: "column.name", className: "" },
  { column: "type", label: "column.type", className: "w-44" },
  { column: "size", label: "column.size", className: "w-28 text-end" },
  { column: "modified", label: "column.modified", className: "w-36" },
];

const SKELETON_ROWS = 8;

/** How far a row-anchored menu starts from the row's inline start, past the icon. */
const MENU_INSET = 24;

/** The keys that move the selection within the list. */
type MoveKey = "ArrowUp" | "ArrowDown" | "Home" | "End" | " ";
const MOVE_KEYS: readonly string[] = ["ArrowUp", "ArrowDown", "Home", "End", " "] satisfies MoveKey[];

/** An open context menu: the listing and row it belongs to, and where it goes. */
interface OpenMenu {
  listing: FolderListing;
  entry: Entry;
  row: HTMLElement;
  position: MenuPosition;
}

function isRtl(element: HTMLElement): boolean {
  return element.closest("[dir]")?.getAttribute("dir") === "rtl";
}

/** At the pointer, for a right-click. */
function atPointer(row: HTMLElement, clientX: number, clientY: number): MenuPosition {
  return { top: clientY, inlineStart: isRtl(row) ? window.innerWidth - clientX : clientX };
}

/** Just below the row's start, for Shift+F10 or the Menu key. */
function atRow(row: HTMLElement): MenuPosition {
  const box = row.getBoundingClientRect();
  const start = isRtl(row) ? window.innerWidth - box.right : box.left;
  return { top: box.bottom, inlineStart: start + MENU_INSET };
}

export function BrowseList({ snapshot, actions }: { snapshot?: BrowseSnapshot; actions?: BrowseActions }) {
  const [order, setOrder] = useState<SortOrder>(DEFAULT_SORT);
  // The selection belongs to the listing it was made in; a new listing starts with the item Show
  // in folder named, if any, until the user selects another.
  const [selection, setSelection] = useState<{ listing: FolderListing; name: string } | null>(null);
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const body = useRef<HTMLTableSectionElement>(null);
  /** The path of the listing on screen before this one; null after an error. */
  const lastPath = useRef<string | null>(null);
  const listing = snapshot?.listing ?? null;
  const rows = useMemo(() => (listing ? sortEntries(listing.entries, order) : []), [listing, order]);
  const selectedIn = (where: FolderListing | null) =>
    where && selection?.listing === where ? selection.name : (where?.selected ?? null);

  // A new listing of the same folder (F5, a re-list after an engine restart) carries the selection
  // over while that name is still listed, unless it names its own item (Show in folder). Adjusted
  // during render, so the row never flickers unselected.
  const [shown, setShown] = useState(listing);
  if (shown !== listing) {
    setShown(listing);
    const name = selectedIn(shown);
    if (listing && shown && name !== null && !listing.selected && shown.path === listing.path) {
      if (listing.entries.some((entry) => entry.name === name)) setSelection({ listing, name });
    }
  }
  const selected = selectedIn(listing);
  const tabStop = rows.some((entry) => entry.name === selected) ? selected : (rows[0]?.name ?? null);

  // When a listing arrives: the row Show in folder named is brought into view and focused.
  // Otherwise focus left on the page (its row was dropped, or a menu closed) goes to the tab-stop
  // row, and so does focus in the list for a new folder, where that is the first row. Focus
  // anywhere else (top bar, nav pane, path field) stays. (The main area's scroll-to-top for a new
  // folder is a layout effect, so it runs before this.)
  useEffect(() => {
    const previous = lastPath.current;
    lastPath.current = listing?.path ?? null;
    if (!listing) return;
    if (listing.selected) {
      const row = body.current?.querySelector<HTMLElement>('tr[aria-selected="true"]');
      if (row) {
        row.scrollIntoView?.({ block: "nearest" });
        row.focus({ preventScroll: true });
        return;
      }
    }
    const active = document.activeElement;
    const onPage = !active || active === document.body;
    const inList = !onPage && body.current?.contains(active) === true;
    if (!onPage && !(inList && listing.path !== previous)) return;
    body.current?.querySelector<HTMLElement>('tr[tabindex="0"]')?.focus({ preventScroll: true });
  }, [listing]);

  /** Selects and focuses the row a ↑/↓/Home/End/Space on `entry`'s row leads to. */
  function move(where: FolderListing, entry: Entry, key: MoveKey) {
    const index = rows.indexOf(entry);
    let target = index;
    if (key === "Home") target = 0;
    else if (key === "End") target = rows.length - 1;
    // The first ↑/↓ selects the focused row; after that they move the selection.
    else if (key !== " " && entry.name === selected) {
      target = Math.min(Math.max(index + (key === "ArrowDown" ? 1 : -1), 0), rows.length - 1);
    }
    setSelection({ listing: where, name: rows[target].name });
    const row = body.current?.rows[target];
    if (!row) return;
    row.scrollIntoView?.({ block: "nearest" });
    row.focus({ preventScroll: true });
  }

  function open(where: FolderListing, entry: Entry) {
    const path = childPath(where.path, entry.name);
    if (entry.kind === "folder") actions?.open(path);
    else actions?.openFile(path);
  }

  // While a new request loads, its skeleton rows replace the previous error.
  if (!listing && snapshot?.error && !snapshot.loading) {
    const icon = snapshot.error === "accessDenied" ? FolderLock : FolderX;
    return <EmptyState icon={icon} text={folderErrorKey(snapshot.error)} />;
  }
  if (listing && listing.entries.length === 0) {
    return <EmptyState icon={FolderOpen} text="browse.empty" />;
  }

  const loading = !listing || snapshot?.loading === true;
  return (
    <>
      <table aria-busy={loading} className="w-full table-fixed border-separate border-spacing-0">
        <thead>
          <tr>
            {COLUMNS.map(({ column, label, className }) => {
              const sorted = order.column === column;
              const Arrow = order.direction === "ascending" ? ChevronUp : ChevronDown;
              return (
                <th
                  key={column}
                  scope="col"
                  aria-sort={sorted ? order.direction : "none"}
                  className={cn(
                    "sticky top-0 z-10 border-b bg-background p-0 text-body-sm font-semibold text-muted-foreground",
                    className,
                  )}
                >
                  <button
                    type="button"
                    onClick={() => setOrder((current) => nextSort(current, column))}
                    className={cn(
                      "flex w-full items-center gap-1 rounded-sm px-2.5 py-2 hover:bg-accent hover:text-accent-foreground",
                      column === "size" ? "justify-end" : "justify-start",
                    )}
                  >
                    {t(label)}
                    {sorted && <Arrow aria-hidden="true" className="size-3.5 shrink-0" />}
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody ref={body}>
          {listing ? (
            rows.map((entry) => (
              <Row
                key={entry.name}
                entry={entry}
                selected={entry.name === selected}
                tabStop={entry.name === tabStop}
                onSelect={() => setSelection({ listing, name: entry.name })}
                onOpen={() => open(listing, entry)}
                onMove={(key) => move(listing, entry, key)}
                onShowInFolder={() => actions?.showInFolder(childPath(listing.path, entry.name))}
                onMenu={(row, position) => {
                  setSelection({ listing, name: entry.name });
                  setMenu({ listing, entry, row, position });
                }}
              />
            ))
          ) : (
            <SkeletonRows />
          )}
        </tbody>
      </table>
      {menu && menu.listing === listing && (
        <RowMenu
          position={menu.position}
          onOpen={() => open(menu.listing, menu.entry)}
          onShowInFolder={() => actions?.showInFolder(childPath(menu.listing.path, menu.entry.name))}
          onClose={() => {
            setMenu(null);
            if (menu.row.isConnected) menu.row.focus({ preventScroll: true });
          }}
        />
      )}
    </>
  );
}

function Row({
  entry,
  selected,
  tabStop,
  onSelect,
  onOpen,
  onMove,
  onShowInFolder,
  onMenu,
}: {
  entry: Entry;
  selected: boolean;
  /** The list's one tab stop: the selected row, or else the first. */
  tabStop: boolean;
  onSelect: () => void;
  onOpen: () => void;
  onMove: (key: MoveKey) => void;
  onShowInFolder: () => void;
  onMenu: (row: HTMLElement, position: MenuPosition) => void;
}) {
  const Icon = ICONS[displayType(entry)];

  function onKeyDown(event: KeyboardEvent<HTMLTableRowElement>) {
    const plain = !event.altKey && !event.ctrlKey && !event.metaKey;
    if (event.key === "Enter" && plain && !event.shiftKey) {
      event.preventDefault();
      // A held key repeats: open once, not one app window per repeat.
      if (!event.repeat) onOpen();
    } else if (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey && plain)) {
      event.preventDefault();
      onMenu(event.currentTarget, atRow(event.currentTarget));
    } else if (MOVE_KEYS.includes(event.key) && plain && !event.shiftKey) {
      // Also keeps the main area from scrolling.
      event.preventDefault();
      onMove(event.key as MoveKey);
    } else if (event.code === "KeyE" && event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey) {
      event.preventDefault();
      if (!event.repeat) onShowInFolder();
    }
  }

  function onContextMenu(event: MouseEvent<HTMLTableRowElement>) {
    event.preventDefault();
    const row = event.currentTarget;
    // A right-click opens at the pointer; a keyboard-made contextmenu event (button 0) at the row.
    onMenu(row, event.button === 2 ? atPointer(row, event.clientX, event.clientY) : atRow(row));
  }

  return (
    <tr
      aria-selected={selected}
      // One tab stop for the whole list; ↑/↓/Home/End move within it.
      tabIndex={tabStop ? 0 : -1}
      onClick={(event) => {
        onSelect();
        event.currentTarget.focus();
      }}
      onDoubleClick={onOpen}
      onKeyDown={onKeyDown}
      onContextMenu={onContextMenu}
      // Scrolled into view below the sticky header, never under it.
      className={cn("h-row scroll-mt-10 cursor-default", selected ? "bg-selection" : "hover:bg-accent")}
    >
      <td className="rounded-s-sm px-2.5">
        <span className="flex min-w-0 items-center gap-2.5">
          <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          <bdi dir="auto" className="truncate">
            {entry.name}
          </bdi>
        </span>
      </td>
      <td className="truncate px-2.5 text-body-sm text-muted-foreground">{typeLabel(entry)}</td>
      <td className="truncate px-2.5 text-end text-body-sm text-muted-foreground">
        {entry.kind === "file" ? formatSize(entry.size) : ""}
      </td>
      <td className="truncate rounded-e-sm px-2.5 text-body-sm text-muted-foreground">{formatDate(entry.modified)}</td>
    </tr>
  );
}

// Shown from the moment a listing starts until its reply arrives (a fast reply replaces them
// at once).
function SkeletonRows() {
  const widths = ["w-3/5", "w-2/5", "w-1/2", "w-3/4", "w-1/3", "w-2/3", "w-1/2", "w-2/5"];
  return Array.from({ length: SKELETON_ROWS }, (_, i) => (
    <tr key={i} className="h-row" data-skeleton="">
      <td className="px-2.5">
        <span className="flex items-center gap-2.5">
          <span className="size-4 shrink-0 animate-pulse rounded-sm bg-muted" />
          <span className={cn("h-3 animate-pulse rounded-sm bg-muted", widths[i % widths.length])} />
        </span>
      </td>
      <td className="px-2.5">
        <span className="block h-3 w-3/4 animate-pulse rounded-sm bg-muted" />
      </td>
      <td className="px-2.5">
        <span className="ms-auto block h-3 w-1/2 animate-pulse rounded-sm bg-muted" />
      </td>
      <td className="px-2.5">
        <span className="block h-3 w-2/3 animate-pulse rounded-sm bg-muted" />
      </td>
    </tr>
  ));
}

function EmptyState({ icon: Icon, text }: { icon: LucideIcon; text: CatalogKey }) {
  return (
    <div role="status" className="flex flex-col items-center gap-3 pt-24 text-center">
      <Icon aria-hidden="true" strokeWidth={1.5} className="size-11 text-muted-foreground" />
      <p>{t(text)}</p>
    </div>
  );
}
