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
import { useMemo, useState } from "react";
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
import { childPath, type BrowseSnapshot } from "./session";
import { DEFAULT_SORT, nextSort, sortEntries, type SortColumn, type SortOrder } from "./sort";

// The browse list (FR-1): a table with a sticky, sortable header. A click selects one row and
// focuses it; double-click or Enter on a folder row opens it (files open in 1.6, ↑/↓ arrive in 1.8). Names are isolated with <bdi dir="auto"> so a
// Hebrew or mixed name reads in its own direction with the extension at its end, while the icon
// stays at the row's start. Logical properties only.

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

export function BrowseList({ snapshot, onOpen }: { snapshot?: BrowseSnapshot; onOpen?: (path: string) => void }) {
  const [order, setOrder] = useState<SortOrder>(DEFAULT_SORT);
  // The selection belongs to the listing it was made in; a new listing starts with none.
  const [selection, setSelection] = useState<{ listing: FolderListing; name: string } | null>(null);
  const listing = snapshot?.listing ?? null;
  const rows = useMemo(() => (listing ? sortEntries(listing.entries, order) : []), [listing, order]);
  const selected = listing && selection?.listing === listing ? selection.name : null;

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
      <tbody>
        {listing ? (
          rows.map((entry) => (
            <Row
              key={entry.name}
              entry={entry}
              selected={entry.name === selected}
              onSelect={() => setSelection({ listing, name: entry.name })}
              onOpen={() => onOpen?.(childPath(listing.path, entry.name))}
            />
          ))
        ) : (
          <SkeletonRows />
        )}
      </tbody>
    </table>
  );
}

function Row({
  entry,
  selected,
  onSelect,
  onOpen,
}: {
  entry: Entry;
  selected: boolean;
  onSelect: () => void;
  onOpen: () => void;
}) {
  const Icon = ICONS[displayType(entry)];
  const isFolder = entry.kind === "folder";
  return (
    <tr
      aria-selected={selected}
      // The selected row is the list's one tab stop (↑/↓ movement arrives in 1.8).
      tabIndex={selected ? 0 : -1}
      onClick={(event) => {
        onSelect();
        event.currentTarget.focus();
      }}
      onDoubleClick={() => {
        if (isFolder) onOpen();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" && isFolder) {
          event.preventDefault();
          onOpen();
        }
      }}
      className={cn("h-row cursor-default", selected ? "bg-selection" : "hover:bg-accent")}
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
