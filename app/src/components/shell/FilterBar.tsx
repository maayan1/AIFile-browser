import { ChevronDown } from "lucide-react";
import { t, type CatalogKey } from "@/i18n/catalog";

// Filter chips (DESIGN.md): pills that read as removable tags. The Date and Type filters arrive
// in Epic 6, so the inactive chips are disabled for now.
function FilterChip({ label }: { label: CatalogKey }) {
  return (
    <button
      type="button"
      disabled
      className="inline-flex h-7 items-center gap-1 rounded-full bg-surface-pane ps-3 pe-2 text-body-sm disabled:opacity-50"
    >
      {t(label)}
      <ChevronDown aria-hidden="true" className="size-3.5" />
    </button>
  );
}

export function FilterBar() {
  return (
    <div role="group" aria-label={t("filter.label")} className="flex shrink-0 items-center gap-2 border-b px-3 py-1.5">
      <FilterChip label="filter.date" />
      <FilterChip label="filter.type" />
    </div>
  );
}
