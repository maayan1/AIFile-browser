import { Search } from "lucide-react";
import { Fragment, useId, useRef, useState } from "react";
import { RowMenu, type MenuPosition } from "@/browse/RowMenu";
import {
  EmptyState,
  FolderErrorState,
  ICONS,
  moveTarget,
  rowContextMenu,
  rowKeyDown,
  type MoveKey,
  type RowHandlers,
} from "@/browse/rows";
import type { BrowseActions, Place } from "@/browse/session";
import { t, type CatalogKey } from "@/i18n/catalog";
import { displayType, formatCount, formatDate, segmentName, typeLabel } from "@/i18n/format";
import { cn } from "@/lib/utils";
import type { SearchDone, SearchParsed } from "@/protocol/generated";
import type { NameMatch, SearchSnapshot } from "./session";

// The search view's main list (FR-4, UX-DR8): the group "Name matches (n)" with one row per match,
// in arrival order (no sorting, no paging), or an empty state. The engine decides "no matches"
// (`searchDone.outcomeCode`); an error shows the browse list's empty state for its code; a search
// still running, or one an engine restart ended, shows no empty state. A row is a type icon, the
// name (two lines, then an ellipsis; the full name in its tooltip) and a meta line "location ·
// date". The location reads like the breadcrumb: the searched folder's segments, then each folder
// below it. The name and every location segment are isolated with <bdi dir="auto">, so Hebrew and
// mixed names read in their own direction with the extension last and the segments in path order.
// Rows behave like the browse list's (rows.tsx): ↑/↓/Home/End/Space, Enter or double-click opens
// (a folder in the app, a file in its default app), the row menu, and Ctrl+Shift+E. A polite live
// region announces how the search ended.

/** Between location segments and before the date; outside the isolates, so they never reorder. */
const SEGMENT_SEPARATOR = " › ";
const DATE_SEPARATOR = " · ";

// Typed so an outcome code without a sentence fails type-checking.
const OUTCOMES: Record<NonNullable<SearchDone["outcomeCode"]>, CatalogKey> = {
  noMatches: "search.noMatches",
};

/** The folders below `root` down to `folder`; null when `folder` isn't in it. */
function below(root: string, folder: string): string[] | null {
  if (folder === root) return [];
  const base = root.endsWith("\\") ? root : `${root}\\`;
  if (!folder.startsWith(base)) return null;
  return folder.slice(base.length).split("\\").filter(Boolean);
}

/**
 * A match's location, segment by segment: the searched folder's breadcrumb names, then each folder
 * below it. Without a place for the searched folder, or for a folder outside it, the whole path.
 */
export function matchLocation(root: Place | null, folder: string): string[] {
  const rest = root ? below(root.path, folder) : null;
  if (!root || rest === null) return folder.split("\\").filter(Boolean);
  return [...root.segments.map(segmentName), ...rest];
}

/** What the live region says once a search has finished; nothing while it runs or after an error. */
function announcement({ done, error, matches }: SearchSnapshot): string {
  if (!done || error) return "";
  if (done.outcomeCode) return t(OUTCOMES[done.outcomeCode]);
  if (matches.length === 0) return "";
  if (matches.length === 1) return t("search.announceMatch");
  return t("search.announceMatches", { count: formatCount(matches.length) });
}

/** An open context menu: the search and row it belongs to, and where it goes. */
interface OpenMenu {
  parsed: SearchParsed | null;
  match: NameMatch;
  row: HTMLElement;
  position: MenuPosition;
}

export function ResultList({ snapshot, actions }: { snapshot: SearchSnapshot; actions?: BrowseActions }) {
  // The selection belongs to the search it was made in (its searchParsed, which every match follows).
  const [selection, setSelection] = useState<{ parsed: SearchParsed | null; path: string } | null>(null);
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const list = useRef<HTMLUListElement>(null);
  const headerId = useId();
  const { parsed, matches, done, error, root } = snapshot;
  const selected = selection && selection.parsed === parsed ? selection.path : null;
  const tabStop = matches.some((match) => match.path === selected) ? selected : (matches[0]?.path ?? null);

  function open(match: NameMatch) {
    if (match.kind === "folder") actions?.open(match.path);
    else actions?.openFile(match.path);
  }

  function move(match: NameMatch, key: MoveKey) {
    const target = moveTarget(matches.indexOf(match), matches.length, key, match.path === selected);
    setSelection({ parsed, path: matches[target].path });
    const row = list.current?.children[target];
    if (!(row instanceof HTMLElement)) return;
    row.scrollIntoView?.({ block: "nearest" });
    row.focus({ preventScroll: true });
  }

  let body = null;
  if (error) {
    body = <FolderErrorState code={error} />;
  } else if (done?.outcomeCode === "noMatches") {
    // The live region below says it; this one stays quiet.
    body = <EmptyState icon={Search} text="search.noMatches" detail="search.tryDifferentWords" announce={false} />;
  } else if (matches.length > 0) {
    body = (
      <section aria-labelledby={headerId}>
        <h2 id={headerId} className="sticky top-0 z-10 bg-background px-2.5 py-2 text-group-label text-muted-foreground">
          {t("search.nameMatches", { count: formatCount(matches.length) })}
        </h2>
        <ul ref={list} role="listbox" aria-labelledby={headerId}>
          {matches.map((match) => (
            <ResultRow
              key={match.path}
              match={match}
              root={root}
              selected={match.path === selected}
              tabStop={match.path === tabStop}
              onSelect={() => setSelection({ parsed, path: match.path })}
              onOpen={() => open(match)}
              onMove={(key) => move(match, key)}
              onShowInFolder={() => actions?.showInFolder(match.path)}
              onMenu={(row, position) => {
                setSelection({ parsed, path: match.path });
                setMenu({ parsed, match, row, position });
              }}
            />
          ))}
        </ul>
      </section>
    );
  }

  return (
    <>
      {body}
      {menu && menu.parsed === parsed && (
        <RowMenu
          position={menu.position}
          onOpen={() => open(menu.match)}
          onShowInFolder={() => actions?.showInFolder(menu.match.path)}
          onClose={() => {
            setMenu(null);
            if (menu.row.isConnected) menu.row.focus({ preventScroll: true });
          }}
        />
      )}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement(snapshot)}
      </div>
    </>
  );
}

function ResultRow({
  match,
  root,
  selected,
  tabStop,
  onSelect,
  ...handlers
}: {
  match: NameMatch;
  root: Place | null;
  selected: boolean;
  /** The list's one tab stop: the selected row, or else the first. */
  tabStop: boolean;
  onSelect: () => void;
} & RowHandlers) {
  const Icon = ICONS[displayType(match)];
  const date = formatDate(match.modified);
  const location = matchLocation(root, match.folder);
  const meta = location.join(SEGMENT_SEPARATOR) + (date ? DATE_SEPARATOR + date : "");
  return (
    <li
      role="option"
      aria-selected={selected}
      // One tab stop for the whole list; ↑/↓/Home/End move within it.
      tabIndex={tabStop ? 0 : -1}
      onClick={(event) => {
        onSelect();
        event.currentTarget.focus();
      }}
      onDoubleClick={handlers.onOpen}
      onKeyDown={(event) => rowKeyDown(event, handlers)}
      onContextMenu={(event) => rowContextMenu(event, handlers.onMenu)}
      // Scrolled into view below the sticky header, never under it.
      className={cn(
        "flex scroll-mt-10 cursor-default items-start gap-2.5 rounded-sm px-2.5 py-1.5",
        selected ? "bg-selection" : "hover:bg-accent",
      )}
    >
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <bdi dir="auto" title={match.name} className="line-clamp-2 [overflow-wrap:anywhere]">
          {match.name}
        </bdi>
        {/* The icon is hidden, so the type is said in words: a folder and a file never sound alike. */}
        <span className="sr-only"> {typeLabel(match)}</span>
        {/* Truncated on screen; the tooltip has the whole location and date. */}
        <p title={meta} className="truncate text-body-sm text-muted-foreground">
          <span data-location="">
            {location.map((name, i) => (
              <Fragment key={i}>
                {i > 0 && SEGMENT_SEPARATOR}
                <bdi dir="auto">{name}</bdi>
              </Fragment>
            ))}
          </span>
          {date && DATE_SEPARATOR + date}
        </p>
      </div>
    </li>
  );
}
