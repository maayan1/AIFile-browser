import { useId, useLayoutEffect, useRef } from "react";
import { BrowseList } from "@/browse/BrowseList";
import type { BrowseActions, BrowseSnapshot } from "@/browse/session";
import { t, type CatalogKey } from "@/i18n/catalog";
import { driveName, knownFolderName } from "@/i18n/format";
import { cn } from "@/lib/utils";
import type { PreviewItem } from "@/preview/session";
import { ResultList } from "@/search/ResultList";
import type { SearchSnapshot } from "@/search/session";

// The content areas of the window. The main list shows the browse list (1.4), or the search
// results while the search view is open (2.2), and the nav pane the places to go (1.5); the Preview
// Panel (2.5) is preview/PreviewPanel.tsx, and status text arrives in Epic 3.
// Only logical properties (border-e/-s), so `dir="rtl"` mirrors them.

interface NavEntry {
  key: string;
  name: string;
  path: string;
  current: boolean;
}

/**
 * "Search folders" (empty until Epic 3), "Quick access" (the known folders that exist) and
 * "This PC" (fixed and removable drives). The entry the first breadcrumb segment names is the
 * current one.
 */
export function NavPane({ browse, actions }: { browse?: BrowseSnapshot; actions?: BrowseActions }) {
  const first = browse?.place?.segments[0];
  const quickAccess = (browse?.locations?.knownFolders ?? []).map((folder) => ({
    key: folder.code,
    name: knownFolderName(folder.code),
    path: folder.path,
    current: first?.kind === "knownFolder" && first.code === folder.code,
  }));
  const thisPc = (browse?.locations?.drives ?? []).map((drive) => ({
    key: drive.letter,
    name: driveName(drive.letter, drive.label),
    path: drive.path,
    current: first?.kind === "drive" && first.letter === drive.letter,
  }));
  const open = (path: string) => actions?.open(path);
  return (
    <nav aria-label={t("nav.label")} className="w-nav shrink-0 overflow-auto border-e bg-surface-pane p-2 text-[0.875rem]">
      <NavGroup heading="nav.searchFolders" entries={[]} onOpen={open} />
      <NavGroup heading="nav.quickAccess" entries={quickAccess} onOpen={open} />
      <NavGroup heading="nav.thisPc" entries={thisPc} onOpen={open} />
    </nav>
  );
}

function NavGroup({ heading, entries, onOpen }: { heading: CatalogKey; entries: NavEntry[]; onOpen: (path: string) => void }) {
  const id = useId();
  return (
    <div role="group" aria-labelledby={id}>
      <h2 id={id} className="mx-2.5 mt-3 mb-1 text-group-label text-muted-foreground uppercase">
        {t(heading)}
      </h2>
      {entries.length > 0 && (
        <ul>
          {entries.map((entry) => (
            <li key={entry.key}>
              <button
                type="button"
                aria-current={entry.current ? "location" : undefined}
                onClick={() => onOpen(entry.path)}
                className={cn(
                  "block w-full truncate rounded-sm px-2.5 py-1.5 text-start",
                  entry.current ? "bg-selection" : "hover:bg-accent hover:text-accent-foreground",
                )}
              >
                <bdi dir="auto">{entry.name}</bdi>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// No top padding: the list's sticky header sits flush with the top of the scrolling area.
// Each folder opens scrolled to its top; a re-list of the same folder keeps the position. A layout
// effect, so it runs before the list scrolls a Show in folder row into view. Opening and leaving
// the search view scroll to the top too. The browse list stays mounted (hidden) under the search
// view, so its sort order and selection are still there when the view closes.
export function MainArea({
  browse,
  actions,
  search,
  onBrowseSelect,
  onSearchSelect,
}: {
  browse?: BrowseSnapshot;
  actions?: BrowseActions;
  search?: SearchSnapshot;
  /** Told the browse list's selected item, for the Preview Panel. */
  onBrowseSelect?: (item: PreviewItem | null) => void;
  /** Told the search results' selected item, for the Preview Panel. */
  onSearchSelect?: (item: PreviewItem | null) => void;
}) {
  const scroller = useRef<HTMLElement>(null);
  const location = browse?.location ?? null;
  const searching = search?.open === true;
  useLayoutEffect(() => {
    if (scroller.current) scroller.current.scrollTop = 0;
  }, [location, searching]);
  return (
    <main ref={scroller} aria-label={t("main.label")} className="min-w-0 flex-1 overflow-auto bg-background px-4">
      <div hidden={searching}>
        <BrowseList snapshot={browse} actions={actions} onSelect={onBrowseSelect} />
      </div>
      {search?.open && <ResultList snapshot={search} actions={actions} onSelect={onSearchSelect} />}
    </main>
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
