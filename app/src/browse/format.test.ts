import { describe, expect, it } from "vitest";
import { t } from "../i18n/catalog";
import { formatDate, formatSize, typeLabel, type Entry } from "../i18n/format";
import type { FileTypeCode } from "../protocol/generated";

const file = (name: string, typeCode: FileTypeCode): Entry => ({ name, kind: "file", typeCode, size: 0, modified: null });

describe("t", () => {
  it("fills placeholders and leaves plain values alone", () => {
    expect(t("type.other", { ext: "RTF" })).toBe("RTF file");
    expect(t("browse.empty")).toBe("This folder is empty.");
  });
});

describe("typeLabel", () => {
  it("words every typeCode from the catalog", () => {
    expect(typeLabel({ name: "Photos", kind: "folder", modified: null })).toBe("File folder");
    expect(typeLabel(file("סיכום ישיבה 3.docx", "word"))).toBe("Word document");
    expect(typeLabel(file("Budget תקציב.pdf", "pdf"))).toBe("PDF document");
    expect(typeLabel(file("phone list.txt", "text"))).toBe("Text document");
    const codes: FileTypeCode[] = ["excel", "powerpoint", "markdown", "image", "audio", "video", "archive"];
    for (const code of codes) expect(typeLabel(file(`x.${code}`, code))).toBe(t(`type.${code}`));
  });

  it("names an unmapped type by its extension, or just File", () => {
    expect(typeLabel(file("notes.rtf", "other"))).toBe("RTF file");
    expect(typeLabel(file("archive.tar.zst", "other"))).toBe("ZST file");
    expect(typeLabel(file("README", "other"))).toBe("File");
    expect(typeLabel(file("ends with dot.", "other"))).toBe("File");
  });
});

describe("formatSize", () => {
  it.each([
    [0, "0 KB"],
    [1, "1 KB"],
    [1024, "1 KB"],
    [1025, "2 KB"],
    [38 * 1024, "38 KB"],
    [38_000, "38 KB"],
    [1024 * 1024 - 1, "1,024 KB"],
    [1024 * 1024, "1 MB"],
    [2.4 * 1024 * 1024, "2.4 MB"],
    [1.2 * 1024 ** 3, "1.2 GB"],
    [3 * 1024 ** 4, "3 TB"],
  ])("%d bytes reads %s", (bytes, text) => {
    expect(formatSize(bytes)).toBe(text);
  });
});

describe("formatDate", () => {
  it("shows the date like the mockup", () => {
    // Midday, so any test machine's time zone keeps the same calendar day.
    expect(formatDate("2025-10-14T12:00:00+00:00")).toBe("Oct 14, 2025");
    expect(formatDate("2025-01-05T12:00:00+00:00")).toBe("Jan 5, 2025");
  });

  it("shows nothing for an unknown time", () => {
    expect(formatDate(null)).toBe("");
    expect(formatDate("not a date")).toBe("");
  });
});
