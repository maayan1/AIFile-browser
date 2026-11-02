// The one string catalog (FR-18): every user-visible sentence lives here, keyed `context.code`.
// English only until Epic 7 adds Hebrew; Story 1.3 extends it.
export const catalog = {
  "engine.restarting": "The search stopped working. Trying again…",
} as const;

export type CatalogKey = keyof typeof catalog;

export function t(key: CatalogKey): string {
  return catalog[key];
}
