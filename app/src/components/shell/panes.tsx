import { t } from "@/i18n/catalog";

// The four content areas of the window, empty frames until their stories fill them:
// nav entries 1.5, browse list 1.4, preview Epic 4, status text Epic 3.
// Only logical properties (border-e/-s), so `dir="rtl"` mirrors them.

export function NavPane() {
  return <nav aria-label={t("nav.label")} className="w-nav shrink-0 overflow-auto border-e bg-surface-pane" />;
}

export function MainArea() {
  return <main aria-label={t("main.label")} className="min-w-0 flex-1 overflow-auto bg-background" />;
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
