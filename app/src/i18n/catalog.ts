// The one string catalog (FR-18, AD-3): every user-visible sentence lives here, keyed `context.code`.
// English only until Epic 7 adds Hebrew. A value may hold `{name}` placeholders, filled by `t`.
export const catalog = {
  "engine.restarting": "The search stopped working. Trying again…",

  "topBar.label": "Navigation and search",
  "topBar.back": "Back",
  "topBar.forward": "Forward",
  "topBar.up": "Up",
  "topBar.settings": "Search folders",
  "breadcrumb.label": "Location",
  "breadcrumb.field": "Folder path",
  "search.label": "Search",
  "search.placeholder": "Search by name, or describe what you remember",
  "filter.label": "Filters",
  "filter.date": "Date",
  "filter.type": "Type",
  "nav.label": "Folders",
  "nav.searchFolders": "Search folders",
  "nav.quickAccess": "Quick access",
  "nav.thisPc": "This PC",
  "main.label": "Files",
  "preview.label": "Preview",
  "preview.empty": "Select a file to preview",
  "status.label": "Status",

  "column.name": "Name",
  "column.type": "Type",
  "column.size": "Size",
  "column.modified": "Modified",

  // Browse list states. The error keys are the engine's error codes.
  "browse.empty": "This folder is empty.",
  "browse.folderNotFound": "This folder doesn't exist.",
  "browse.accessDenied": "You don't have permission to open this folder.",
  "browse.unavailable": "This folder can't be shown right now.",

  // One name per engine known-folder code, and the two ways a drive is named ({letter} is "C").
  "knownFolder.documents": "Documents",
  "knownFolder.desktop": "Desktop",
  "knownFolder.downloads": "Downloads",
  "drive.labelled": "{label} ({letter}:)",
  "drive.unlabelled": "Local Disk ({letter}:)",

  // One label per engine typeCode.
  "type.folder": "File folder",
  "type.pdf": "PDF document",
  "type.word": "Word document",
  "type.excel": "Excel workbook",
  "type.powerpoint": "PowerPoint presentation",
  "type.text": "Text document",
  "type.markdown": "Markdown document",
  "type.image": "Image",
  "type.audio": "Audio file",
  "type.video": "Video file",
  "type.archive": "Compressed file",
  "type.other": "{ext} file",
  "type.otherNoExtension": "File",

  "size.kilobytes": "{size} KB",
  "size.megabytes": "{size} MB",
  "size.gigabytes": "{size} GB",
  "size.terabytes": "{size} TB",
} as const;

export type CatalogKey = keyof typeof catalog;

/** The locale every number and date is formatted in (English only this epic). */
export const LOCALE = "en-US";

/** The catalog text for `key`, with each `{name}` replaced by `values[name]`. */
export function t(key: CatalogKey, values?: Record<string, string>): string {
  const text: string = catalog[key];
  if (!values) return text;
  return text.replace(/\{([a-zA-Z]+)\}/g, (placeholder, name: string) => values[name] ?? placeholder);
}
