import { ChevronDown, ChevronUp, FolderOpen } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { t, type CatalogKey } from "@/i18n/catalog";
import { displayType, formatDate, formatSize, typeLabel, type Entry } from "@/i18n/format";
import { cn } from "@/lib/utils";
import type { FolderListing } from "@/protocol/generated";
import { previewKey, type PreviewItem } from "@/preview/session";
import { RenameFile } from "./RenameFile";
import { RowMenu, type MenuPosition } from "./RowMenu";
import { EmptyState, FolderErrorState, ICONS, moveTarget, rowContextMenu, rowKeyDown, type MoveKey } from "./rows";
import { childPath, type BrowseActions, type BrowseSnapshot } from "./session";
import { DEFAULT_SORT, nextSort, sortEntries, type SortColumn, type SortOrder } from "./sort";

// The browse list (FR-1, FR-3): a table with a sticky, sortable header. A click selects one row
// and focuses it; double-click or Enter opens it: a folder in the app, a file in its Windows
// default app. A right click, Shift+F10 or the Menu key selects the row and opens its menu (Open,
// Show in folder, and Rename on a file); Ctrl+Shift+E runs Show in folder, and F2 renames a file
// (never a folder: C-4's Rename exception) in a form below its row. Focus and selection are separate, as in File
// Explorer (UX-DR22): the list's one tab stop is the selected row, or else the first; ↑/↓ select the
// focused row, then move the selection and focus (no wrap); Home/End go to the ends; Space selects.
// A new folder's listing selects nothing and, when focus was on the page or in the list, focuses its
// first row; a re-list of the same folder (F5) keeps the selection. After Show in folder the
// listing names the item to select, and that row is scrolled into view and focused. Names are
// isolated with <bdi dir="auto"> so a Hebrew or mixed name reads in its own direction with the
// extension at its end, while the icon stays at the row's start. Logical properties only. The row
// keys, icons and empty states are shared with the search results (rows.tsx). Whenever the selected
// row changes (or none is selected any more), `onSelect` hears of it, for the Preview Panel.

const COLUMNS: { column: SortColumn; label: CatalogKey; className: string }[] = [
  { column: "name", label: "column.name", className: "" },
  { column: "type", label: "column.type", className: "w-44" },
  { column: "size", label: "column.size", className: "w-28 text-end" },
  { column: "modified", label: "column.modified", className: "w-36" },
];

const SKELETON_ROWS = 8;

/** A file being renamed: the listing and row it belongs to. */
interface Renaming {
  listing: FolderListing;
  entry: Entry;
  row: HTMLElement;
}

/** An open context menu: the listing and row it belongs to, and where it goes. */
interface OpenMenu {
  listing: FolderListing;
  entry: Entry;
  row: HTMLElement;
  position: MenuPosition;
}

/** A listed entry as the Preview Panel knows it. */
function previewItem(folder: string, entry: Entry): PreviewItem {
  const path = childPath(folder, entry.name);
  if (entry.kind === "folder") return { kind: "folder", path, name: entry.name, modified: entry.modified };
  return { kind: "file", path, name: entry.name, typeCode: entry.typeCode, size: entry.size, modified: entry.modified };
}

export function BrowseList({
  snapshot,
  actions,
  onSelect,
}: {
  snapshot?: BrowseSnapshot;
  actions?: BrowseActions;
  /** Told the selected row's item, or null with none selected, each time that changes. */
  onSelect?: (item: PreviewItem | null) => void;
}) {
  const [order, setOrder] = useState<SortOrder>(DEFAULT_SORT);
  // The selection belongs to the listing it was made in; a new listing starts with the item Show
  // in folder named, if any, until the user selects another.
  const [selection, setSelection] = useState<{ listing: FolderListing; name: string } | null>(null);
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const [renaming, setRenaming] = useState<Renaming | null>(null);
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
  const selectedEntry = selected === null ? undefined : listing?.entries.find((entry) => entry.name === selected);
  const selectedItem = listing && selectedEntry ? previewItem(listing.path, selectedEntry) : null;
  const selectedKey = previewKey(selectedItem);
  // Keyed on the item, so a re-render, or a re-list with the file unchanged, says nothing new.
  useEffect(() => {
    onSelect?.(selectedItem);
  }, [selectedKey, onSelect]);

  // The Rename form belongs to its folder and file: another folder listed, or the file gone from a
  // re-list, closes it.
  const renameOpen =
    renaming !== null && listing !== null && renaming.listing.path === listing.path &&
    listing.entries.some((entry) => entry.name === renaming.entry.name);
  if (renaming && !renameOpen) setRenaming(null);
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
    const target = moveTarget(rows.indexOf(entry), rows.length, key, entry.name === selected);
    setSelection({ listing: where, name: rows[target].name });
    const row = body.current?.rows[target];
    if (!row) return;
    row.scrollIntoView?.({ block: "nearest" });
    row.focus({ preventScroll: true });
  }

  /** Rename for a file row, when the session can rename; folders never get it. */
  function renameFor(where: FolderListing, entry: Entry) {
    if (entry.kind !== "file" || !actions) return undefined;
    return (row: HTMLElement) => {
      setSelection({ listing: where, name: entry.name });
      setRenaming({ listing: where, entry, row });
    };
  }

  function open(where: FolderListing, entry: Entry) {
    const path = childPath(where.path, entry.name);
    if (entry.kind === "folder") actions?.open(path);
    else actions?.openFile(path);
  }

  // While a new request loads, its skeleton rows replace the previous error.
  if (!listing && snapshot?.error && !snapshot.loading) {
    return <FolderErrorState code={snapshot.error} />;
  }
  if (listing && listing.entries.length === 0) {
    return <EmptyState icon={FolderOpen} text="browse.empty" />;
  }

  const loading = !listing || snapshot?.loading === true;
  const menuRename = menu ? renameFor(menu.listing, menu.entry) : undefined;
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
                onRename={renameFor(listing, entry)}
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
          onRename={menuRename && (() => menuRename(menu.row))}
          onClose={() => {
            setMenu(null);
            if (menu.row.isConnected) menu.row.focus({ preventScroll: true });
          }}
        />
      )}
      {renameOpen && actions && (
        <RenameFile
          folder={renaming.listing.path}
          name={renaming.entry.name}
          row={renaming.row}
          onRename={(folder, name, newName) => actions.renameFile(folder, name, newName)}
          onClose={() => setRenaming(null)}
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
  onRename,
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
  /** Given for a file the session can rename: F2 opens the Rename form for this row. */
  onRename?: (row: HTMLElement) => void;
  onMenu: (row: HTMLElement, position: MenuPosition) => void;
}) {
  const Icon = ICONS[displayType(entry)];

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
      onKeyDown={(event) => {
        const row = event.currentTarget;
        rowKeyDown(event, { onOpen, onMove, onShowInFolder, onMenu, onRename: onRename && (() => onRename(row)) });
      }}
      onContextMenu={(event) => rowContextMenu(event, onMenu)}
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
