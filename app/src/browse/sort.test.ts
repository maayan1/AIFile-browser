import { describe, expect, it } from "vitest";
import type { Entry } from "../i18n/format";
import { DEFAULT_SORT, nextSort, sortEntries, type SortColumn, type SortDirection } from "./sort";

const folder = (name: string, modified: string | null = null): Entry => ({ name, kind: "folder", modified });
const file = (
  name: string,
  typeCode: Extract<Entry, { kind: "file" }>["typeCode"],
  size: number,
  modified: string | null,
): Entry => ({ name, kind: "file", typeCode, size, modified });

const ENTRIES: Entry[] = [
  file("report 10.pdf", "pdf", 2_000, "2025-10-02T12:00:00+03:00"),
  folder("Photos", "2025-10-20T18:04:11+03:00"),
  file("report 2.pdf", "pdf", 500, "2025-06-30T20:15:42+03:00"),
  file("סיכום ישיבה 3.docx", "word", 38_912, "2025-10-14T09:30:00+03:00"),
  folder("archive", "2024-01-01T00:00:00+02:00"),
  file("Budget תקציב.pdf", "pdf", 500, null),
  file("notes.txt", "text", 10, "2025-01-05T08:00:00+02:00"),
];

const names = (column: SortColumn, direction: SortDirection) =>
  sortEntries(ENTRIES, { column, direction }).map((e) => e.name);

describe("sortEntries", () => {
  it("sorts by name in natural order, ignoring case, folders first", () => {
    expect(names("name", "ascending")).toEqual([
      "archive",
      "Photos",
      "Budget תקציב.pdf",
      "notes.txt",
      "report 2.pdf",
      "report 10.pdf",
      "סיכום ישיבה 3.docx",
    ]);
    expect(names("name", "descending")).toEqual([
      "Photos",
      "archive",
      "סיכום ישיבה 3.docx",
      "report 10.pdf",
      "report 2.pdf",
      "notes.txt",
      "Budget תקציב.pdf",
    ]);
  });

  it("sorts by the displayed type label, ties by name", () => {
    // "PDF document" < "Text document" < "Word document"
    expect(names("type", "ascending")).toEqual([
      "archive",
      "Photos",
      "Budget תקציב.pdf",
      "report 2.pdf",
      "report 10.pdf",
      "notes.txt",
      "סיכום ישיבה 3.docx",
    ]);
    expect(names("type", "descending")).toEqual([
      "archive",
      "Photos",
      "סיכום ישיבה 3.docx",
      "notes.txt",
      "Budget תקציב.pdf",
      "report 2.pdf",
      "report 10.pdf",
    ]);
  });

  it("sorts by size numerically, ties by name", () => {
    expect(names("size", "ascending")).toEqual([
      "archive",
      "Photos",
      "notes.txt",
      "Budget תקציב.pdf",
      "report 2.pdf",
      "report 10.pdf",
      "סיכום ישיבה 3.docx",
    ]);
    expect(names("size", "descending")).toEqual([
      "archive",
      "Photos",
      "סיכום ישיבה 3.docx",
      "report 10.pdf",
      "Budget תקציב.pdf",
      "report 2.pdf",
      "notes.txt",
    ]);
  });

  it("sorts by modified time, unknown times oldest", () => {
    expect(names("modified", "ascending")).toEqual([
      "archive",
      "Photos",
      "Budget תקציב.pdf",
      "notes.txt",
      "report 2.pdf",
      "report 10.pdf",
      "סיכום ישיבה 3.docx",
    ]);
    expect(names("modified", "descending")).toEqual([
      "Photos",
      "archive",
      "סיכום ישיבה 3.docx",
      "report 10.pdf",
      "report 2.pdf",
      "notes.txt",
      "Budget תקציב.pdf",
    ]);
  });

  it("compares instants, not strings, across offsets", () => {
    const entries = [
      file("later.txt", "text", 1, "2025-10-14T10:00:00+03:00"), // 07:00Z
      file("earlier.txt", "text", 1, "2025-10-14T09:00:00+00:00"), // 09:00Z is later
    ];
    expect(sortEntries(entries, { column: "modified", direction: "ascending" }).map((e) => e.name)).toEqual([
      "later.txt",
      "earlier.txt",
    ]);
  });

  it("leaves the input untouched", () => {
    const before = ENTRIES.map((e) => e.name);
    sortEntries(ENTRIES, { column: "size", direction: "descending" });
    expect(ENTRIES.map((e) => e.name)).toEqual(before);
  });
});

describe("nextSort", () => {
  it("starts on name ascending, reverses on a second click, and starts a new column ascending", () => {
    expect(DEFAULT_SORT).toEqual({ column: "name", direction: "ascending" });
    const reversed = nextSort(DEFAULT_SORT, "name");
    expect(reversed).toEqual({ column: "name", direction: "descending" });
    expect(nextSort(reversed, "name")).toEqual(DEFAULT_SORT);
    expect(nextSort(reversed, "size")).toEqual({ column: "size", direction: "ascending" });
  });
});
