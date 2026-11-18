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
  "search.clear": "Clear search",
  // The search results. Each searchDone outcome code and notice code has a `search.<code>` sentence.
  "search.nameMatches": "Name matches ({count})",
  "search.noMatches": "No matching files found",
  "search.tryDifferentWords": "Try different words.",
  "search.stopped": "Search stopped.",
  "search.permissionSkipped": "Some folders couldn't be searched because you don't have permission.",
  "search.announceMatches": "{count} name matches found",
  "search.announceMatch": "1 name match found",
  "filter.label": "Filters",
  "filter.date": "Date",
  "filter.type": "Type",
  "nav.label": "Folders",
  "nav.searchFolders": "Search folders",
  "nav.quickAccess": "Quick access",
  "nav.thisPc": "This PC",
  "main.label": "Files",
  // The Preview Panel. Each readOutcomeCodes code (protocol/codes.json) has a `preview.<code>` sentence.
  "preview.label": "Preview",
  "preview.empty": "Select a file to preview",
  "preview.type": "Type",
  "preview.size": "Size",
  "preview.modified": "Modified",
  "preview.location": "Location",
  "preview.storedOnlyInOneDrive": "Stored only in OneDrive",
  "preview.tooLarge": "This file is too large to preview",
  "preview.cannotRead": "This file can't be read",
  "status.label": "Status",

  "column.name": "Name",
  "column.type": "Type",
  "column.size": "Size",
  "column.modified": "Modified",

  // The browse list's context menu: only these two items, ever (read-only, C-4).
  "menu.label": "File actions",
  "menu.open": "Open",
  "menu.showInFolder": "Show in folder",

  // New file (the one write: an empty file in the listed folder). Each error code a createFile can
  // end with has a `newFile.<code>` sentence; anything else is `newFile.failed`.
  "newFile.button": "New file",
  "newFile.dialog": "New file",
  "newFile.name": "File name",
  "newFile.create": "Create",
  "newFile.cancel": "Cancel",
  "newFile.invalidName":
    "That name can't be used. Type one file name without slashes, colons or other special characters, and don't end it with a dot or a space.",
  "newFile.fileExists": "There's already a file or folder with that name here.",
  "newFile.folderNotFound": "This folder doesn't exist anymore.",
  "newFile.accessDenied": "You don't have permission to create files in this folder.",
  "newFile.folderUnavailable": "This folder can't be reached right now.",
  "newFile.failed": "The file couldn't be created. Try again.",

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
