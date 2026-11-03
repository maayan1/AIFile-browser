// The one string catalog (FR-18, AD-3): every user-visible sentence lives here, keyed `context.code`.
// English only until Epic 7 adds Hebrew.
export const catalog = {
  "engine.restarting": "The search stopped working. Trying again…",

  "topBar.label": "Navigation and search",
  "topBar.back": "Back",
  "topBar.forward": "Forward",
  "topBar.up": "Up",
  "topBar.settings": "Search folders",
  "breadcrumb.label": "Location",
  "search.label": "Search",
  "search.placeholder": "Search by name, or describe what you remember",
  "filter.label": "Filters",
  "filter.date": "Date",
  "filter.type": "Type",
  "nav.label": "Folders",
  "main.label": "Files",
  "preview.label": "Preview",
  "preview.empty": "Select a file to preview",
  "status.label": "Status",
} as const;

export type CatalogKey = keyof typeof catalog;

export function t(key: CatalogKey): string {
  return catalog[key];
}
