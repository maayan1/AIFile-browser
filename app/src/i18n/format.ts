// How engine data reads on screen: type labels, sizes, dates, places and folder errors, all
// worded by the catalog.
import type {
  DriveSegment,
  FileEntry,
  FolderEntry,
  FolderSegment,
  KnownFolderCode,
  KnownFolderSegment,
} from "../protocol/generated";
import { LOCALE, t, type CatalogKey } from "./catalog";

// Typed so a known-folder code without a catalog name fails type-checking.
const KNOWN_FOLDER_NAMES: Record<KnownFolderCode, CatalogKey> = {
  documents: "knownFolder.documents",
  desktop: "knownFolder.desktop",
  downloads: "knownFolder.downloads",
};

/** "Documents", "Desktop", "Downloads". */
export function knownFolderName(code: KnownFolderCode): string {
  return t(KNOWN_FOLDER_NAMES[code]);
}

/** "OS (C:)", or "Local Disk (C:)" for a drive without a label. */
export function driveName(letter: string, label: string | null): string {
  return label ? t("drive.labelled", { label, letter }) : t("drive.unlabelled", { letter });
}

export type Segment = KnownFolderSegment | DriveSegment | FolderSegment;

/** A breadcrumb segment's text: a known folder or drive worded by the catalog, else the folder's name. */
export function segmentName(segment: Segment): string {
  switch (segment.kind) {
    case "knownFolder":
      return knownFolderName(segment.code);
    case "drive":
      return driveName(segment.letter, segment.label);
    case "folder":
      return segment.name;
  }
}

/** Folder error codes with their own sentence; any other code reads as `browse.unavailable`. */
const FOLDER_ERRORS: Record<string, CatalogKey> = {
  folderNotFound: "browse.folderNotFound",
  accessDenied: "browse.accessDenied",
};

export function folderErrorKey(code: string): CatalogKey {
  return Object.hasOwn(FOLDER_ERRORS, code) ? FOLDER_ERRORS[code] : "browse.unavailable";
}

export type Entry = FolderEntry | FileEntry;

/** The type a row shows: `folder` for folders, else the engine's typeCode. */
export type DisplayType = "folder" | FileEntry["typeCode"];

export function displayType(entry: Entry): DisplayType {
  return entry.kind === "folder" ? "folder" : entry.typeCode;
}

/** "Word document", "File folder", "RTF file" for an unmapped extension, "File" without one. */
// Typed so a type code without a catalog label fails type-checking.
const TYPE_LABELS: Record<Exclude<DisplayType, "other">, CatalogKey> = {
  folder: "type.folder",
  pdf: "type.pdf",
  word: "type.word",
  excel: "type.excel",
  powerpoint: "type.powerpoint",
  text: "type.text",
  markdown: "type.markdown",
  image: "type.image",
  audio: "type.audio",
  video: "type.video",
  archive: "type.archive",
};

export function typeLabel(entry: Entry): string {
  const type = displayType(entry);
  if (type !== "other") return t(TYPE_LABELS[type]);
  const dot = entry.name.lastIndexOf(".");
  const ext = dot >= 0 ? entry.name.slice(dot + 1) : "";
  return ext ? t("type.other", { ext: ext.toLocaleUpperCase(LOCALE) }) : t("type.otherNoExtension");
}

const KB = 1024;
const MB = KB * 1024;
const GB = MB * 1024;
const TB = GB * 1024;

const whole = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 });
const oneDecimal = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 1 });

/** Like File Explorer: whole KB rounded up below 1 MB ("0 KB", "38 KB"), then "2.4 MB", "1.2 GB". */
export function formatSize(bytes: number): string {
  if (bytes < MB) return t("size.kilobytes", { size: whole.format(Math.ceil(bytes / KB)) });
  if (bytes < GB) return t("size.megabytes", { size: oneDecimal.format(bytes / MB) });
  if (bytes < TB) return t("size.gigabytes", { size: oneDecimal.format(bytes / GB) });
  return t("size.terabytes", { size: oneDecimal.format(bytes / TB) });
}

const dateFormat = new Intl.DateTimeFormat(LOCALE, { month: "short", day: "numeric", year: "numeric" });

/** "Oct 14, 2025" in the user's time zone; "" when the engine doesn't know the time. */
export function formatDate(iso: string | null): string {
  if (iso === null) return "";
  const time = Date.parse(iso);
  return Number.isNaN(time) ? "" : dateFormat.format(time);
}
