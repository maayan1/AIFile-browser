// Sorting the shown rows: presentation only, the engine sends them unsorted.
import { LOCALE } from "../i18n/catalog";
import { typeLabel, type Entry } from "../i18n/format";

export type SortColumn = "name" | "type" | "size" | "modified";
export type SortDirection = "ascending" | "descending";

export interface SortOrder {
  column: SortColumn;
  direction: SortDirection;
}

export const DEFAULT_SORT: SortOrder = { column: "name", direction: "ascending" };

/** Clicking the sorted column reverses it; another column starts ascending. */
export function nextSort(current: SortOrder, column: SortColumn): SortOrder {
  if (current.column !== column) return { column, direction: "ascending" };
  return { column, direction: current.direction === "ascending" ? "descending" : "ascending" };
}

// Natural order ("file 2" before "file 10"), ignoring case and accents, like File Explorer.
const collator = new Intl.Collator(LOCALE, { numeric: true, sensitivity: "base" });

function byName(a: Entry, b: Entry): number {
  return collator.compare(a.name, b.name);
}

function sizeOf(entry: Entry): number {
  return entry.kind === "file" ? entry.size : -1;
}

function timeOf(entry: Entry): number {
  if (entry.modified === null) return Number.NEGATIVE_INFINITY;
  const time = Date.parse(entry.modified);
  return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
}

function numeric(x: number, y: number): number {
  return x === y ? 0 : x < y ? -1 : 1; // safe for -Infinity, unlike x - y
}

function compareBy(column: SortColumn): (a: Entry, b: Entry) => number {
  switch (column) {
    case "name":
      return byName;
    case "type":
      return (a, b) => collator.compare(typeLabel(a), typeLabel(b));
    case "size":
      return (a, b) => numeric(sizeOf(a), sizeOf(b));
    case "modified":
      return (a, b) => numeric(timeOf(a), timeOf(b));
  }
}

/**
 * A sorted copy: folders always before files, then by the column in the given direction, and
 * ties by name (ascending).
 */
export function sortEntries(entries: readonly Entry[], order: SortOrder): Entry[] {
  const compare = compareBy(order.column);
  const sign = order.direction === "ascending" ? 1 : -1;
  return [...entries].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
    const result = compare(a, b);
    if (result !== 0) return sign * result;
    return order.column === "name" ? 0 : byName(a, b);
  });
}
