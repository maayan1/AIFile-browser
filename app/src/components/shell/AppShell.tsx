import type { BrowseActions, BrowseSnapshot } from "@/browse/session";
import { EngineBanner } from "@/components/EngineBanner";
import { FilterBar } from "./FilterBar";
import { MainArea, NavPane, PreviewPanel, StatusBar } from "./panes";
import { TopBar } from "./TopBar";

// The main window frame (UX-DR4), laid out like File Explorer. DOM order is the tab order:
// top bar → filter bar → nav pane → main list → Preview Panel → status bar (UX-DR22).
// Only logical properties, so `dir="rtl"` on <html> mirrors it all.
export function AppShell({
  bannerVisible,
  browse,
  actions,
}: {
  bannerVisible: boolean;
  browse?: BrowseSnapshot;
  /** The browse session's navigation; without it every navigation control is inert. */
  actions?: BrowseActions;
}) {
  return (
    <div className="flex h-full flex-col">
      <TopBar browse={browse} actions={actions} />
      <FilterBar />
      <EngineBanner visible={bannerVisible} />

      <div className="flex min-h-0 flex-1">
        <NavPane browse={browse} actions={actions} />
        <MainArea browse={browse} actions={actions} />
        <PreviewPanel />
      </div>

      <StatusBar />
    </div>
  );
}
