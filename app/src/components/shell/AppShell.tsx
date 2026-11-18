import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BrowseActions, BrowseSnapshot } from "@/browse/session";
import { useBrowseShortcuts } from "@/browse/shortcuts";
import type { SearchActions, SearchSnapshot } from "@/search/session";
import { EngineBanner } from "@/components/EngineBanner";
import { PreviewPanel } from "@/preview/PreviewPanel";
import { previewKey, type PreviewActions, type PreviewItem, type PreviewSnapshot } from "@/preview/session";
import { FilterBar } from "./FilterBar";
import { MainArea, NavPane, StatusBar } from "./panes";
import { TopBar } from "./TopBar";

// The main window frame (UX-DR4), laid out like File Explorer. DOM order is the tab order:
// top bar → filter bar → nav pane → main list → Preview Panel → status bar (UX-DR22).
// Only logical properties, so `dir="rtl"` on <html> mirrors it all. It holds the Search Bar's text,
// because leaving the search view clears it: Esc (window-wide while the view is open), ✕, and every
// navigation (a folder opened, Show in folder, Back/Forward/Up, the breadcrumb, the nav pane or a
// typed path). F5 and opening a file stay in the view. Esc while a search runs only stops it: the
// view, the text and the focus stay, and the next Esc leaves. ✕ and navigation always leave, and
// leaving cancels a running search first (the search session's `close`). The Preview Panel follows
// the selection of the list on screen: the search results' while the view is open, else the
// browse list's (which stays mounted, with its selection, under the search view).

/** `actions` with each navigation leaving the search view first (`leave`); F5 and opening a file don't. */
function leavingSearch(actions: BrowseActions, browse: BrowseSnapshot | undefined, leave: () => void): BrowseActions {
  const leaving = (navigate: () => void) => {
    leave();
    navigate();
  };
  return {
    open: (path) => leaving(() => actions.open(path)),
    openTyped: (path) => leaving(() => actions.openTyped(path)),
    showInFolder: (path) => leaving(() => actions.showInFolder(path)),
    // Alt+←/→/↑ with nowhere to go navigate nowhere, so they stay in the view.
    back: () => (browse?.canBack ? leaving(() => actions.back()) : actions.back()),
    forward: () => (browse?.canForward ? leaving(() => actions.forward()) : actions.forward()),
    up: () => (browse?.place?.parent ? leaving(() => actions.up()) : actions.up()),
    openFile: (path) => actions.openFile(path),
    reload: () => actions.reload(),
    clearPathError: () => actions.clearPathError(),
    createFile: (folder, name) => actions.createFile(folder, name),
    renameFile: (folder, name, newName) => actions.renameFile(folder, name, newName),
  };
}

export function AppShell({
  bannerVisible,
  browse,
  actions,
  search,
  searchActions,
  preview,
  previewActions,
}: {
  bannerVisible: boolean;
  browse?: BrowseSnapshot;
  /** The browse session's navigation; without it every navigation control is inert. */
  actions?: BrowseActions;
  search?: SearchSnapshot;
  /** The search session; without it Enter in the Search Bar sends nothing. */
  searchActions?: SearchActions;
  preview?: PreviewSnapshot;
  /** The preview session; without it a selected file's thumbnail never loads. */
  previewActions?: PreviewActions;
}) {
  const searchInput = useRef<HTMLInputElement>(null);
  const [searchText, setSearchText] = useState("");
  const searching = search?.open === true;
  const [browseItem, setBrowseItem] = useState<PreviewItem | null>(null);
  const [searchItem, setSearchItem] = useState<PreviewItem | null>(null);
  // A closed search view's selection is gone: the next one starts with none, never the last one's.
  if (!searching && searchItem !== null) setSearchItem(null);
  const selectedItem = searching ? searchItem : browseItem;
  const selectedKey = previewKey(selectedItem);
  // Keyed on the item, so the panel asks the engine only when the selection really changes.
  useEffect(() => {
    previewActions?.select(selectedItem);
  }, [selectedKey, previewActions]);
  // Focused with its text selected, so typing replaces the last search (as in File Explorer).
  const focusSearch = useCallback(() => {
    searchInput.current?.focus();
    searchInput.current?.select();
  }, []);
  const leaveSearch = useCallback(() => {
    setSearchText("");
    searchActions?.close();
  }, [searchActions]);
  const running = search?.running === true;
  // Esc: a running search stops and everything stays. Otherwise it leaves: focus in the results
  // (about to go) moves to the Search Bar; focus anywhere else stays.
  const escape = useCallback(() => {
    if (running) {
      searchActions?.cancel();
      return;
    }
    const active = document.activeElement;
    const lost = !active || active === document.body || active.closest("main") !== null;
    leaveSearch();
    if (lost) searchInput.current?.focus();
  }, [running, searchActions, leaveSearch]);
  const navigation = useMemo(
    () => (actions && searching ? leavingSearch(actions, browse, leaveSearch) : actions),
    [actions, browse, searching, leaveSearch],
  );
  // Alt+←/→/↑ and F5 from anywhere in the window; Ctrl+E, Ctrl+F and F3 focus the Search Bar.
  useBrowseShortcuts(navigation, focusSearch, searching ? escape : undefined);
  return (
    <div className="flex h-full flex-col">
      <TopBar
        browse={browse}
        actions={navigation}
        search={search}
        searchActions={searchActions}
        searchInput={searchInput}
        searchText={searchText}
        onSearchText={setSearchText}
        onClearSearch={leaveSearch}
      />
      <FilterBar />
      <EngineBanner visible={bannerVisible} />

      <div className="flex min-h-0 flex-1">
        <NavPane browse={browse} actions={navigation} />
        <MainArea
          browse={browse}
          actions={navigation}
          search={search}
          onBrowseSelect={setBrowseItem}
          onSearchSelect={setSearchItem}
        />
        <PreviewPanel item={selectedItem} preview={preview} />
      </div>

      <StatusBar />
    </div>
  );
}
