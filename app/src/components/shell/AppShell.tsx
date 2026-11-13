import { useCallback, useRef } from "react";
import type { BrowseActions, BrowseSnapshot } from "@/browse/session";
import { useBrowseShortcuts } from "@/browse/shortcuts";
import type { SearchActions, SearchSnapshot } from "@/search/session";
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
  search,
  searchActions,
}: {
  bannerVisible: boolean;
  browse?: BrowseSnapshot;
  /** The browse session's navigation; without it every navigation control is inert. */
  actions?: BrowseActions;
  search?: SearchSnapshot;
  /** The search session; without it Enter in the Search Bar sends nothing. */
  searchActions?: SearchActions;
}) {
  const searchInput = useRef<HTMLInputElement>(null);
  // Focused with its text selected, so typing replaces the last search (as in File Explorer).
  const focusSearch = useCallback(() => {
    searchInput.current?.focus();
    searchInput.current?.select();
  }, []);
  // Alt+←/→/↑ and F5 from anywhere in the window; Ctrl+E, Ctrl+F and F3 focus the Search Bar.
  useBrowseShortcuts(actions, focusSearch);
  return (
    <div className="flex h-full flex-col">
      <TopBar browse={browse} actions={actions} search={search} searchActions={searchActions} searchInput={searchInput} />
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
