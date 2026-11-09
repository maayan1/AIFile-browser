import { BrowseList } from "@/browse/BrowseList";
import type { BrowseSnapshot } from "@/browse/session";
import { t } from "@/i18n/catalog";

// The four content areas of the window. The main list shows the browse list (1.4); the rest are
// empty frames until their stories fill them: nav entries 1.5, preview Epic 4, status text Epic 3.
// Only logical properties (border-e/-s), so `dir="rtl"` mirrors them.

export function NavPane() {
  return <nav aria-label={t("nav.label")} className="w-nav shrink-0 overflow-auto border-e bg-surface-pane" />;
}

// No top padding: the list's sticky header sits flush with the top of the scrolling area.
export function MainArea({ browse }: { browse?: BrowseSnapshot }) {
  return (
    <main aria-label={t("main.label")} className="min-w-0 flex-1 overflow-auto bg-background px-4">
      <BrowseList snapshot={browse} />
    </main>
  );
}

// Below 1280px the Preview Panel collapse is Story 4.1's job.
export function PreviewPanel() {
  return (
    <aside
      aria-label={t("preview.label")}
      className="flex w-preview shrink-0 items-center justify-center overflow-auto border-s bg-surface-pane p-4"
    >
      <p className="text-center text-muted-foreground">{t("preview.empty")}</p>
    </aside>
  );
}

export function StatusBar() {
  return (
    <footer
      aria-label={t("status.label")}
      className="flex h-status shrink-0 items-center border-t bg-surface-pane px-3 text-body-sm"
    />
  );
}
