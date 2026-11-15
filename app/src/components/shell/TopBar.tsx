import { ArrowLeft, ArrowRight, ArrowUp, LoaderCircle, Search, Settings, X } from "lucide-react";
import { useState, type ComponentType, type KeyboardEvent, type RefObject } from "react";
import { Breadcrumb } from "@/browse/Breadcrumb";
import type { BrowseActions, BrowseSnapshot } from "@/browse/session";
import { Button } from "@/components/ui/button";
import { t, type CatalogKey } from "@/i18n/catalog";
import { cn } from "@/lib/utils";
import type { SearchActions, SearchSnapshot } from "@/search/session";

// Top bar (UX-DR4). Back, Forward and Up follow the browse session (1.5); the Search Bar searches
// the listed folder on Enter (2.1); Search folders arrives in Epic 3, so it stays inert. Back and
// forward mirror under `dir="rtl"`; up and the gear have no direction.
function IconButton({
  label,
  icon: Icon,
  mirrored = false,
  onClick,
}: {
  label: CatalogKey;
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" }>;
  mirrored?: boolean;
  /** Without one the button is disabled. */
  onClick?: () => void;
}) {
  return (
    <Button variant="ghost" size="icon" disabled={!onClick} onClick={onClick} aria-label={t(label)} title={t(label)}>
      <Icon aria-hidden="true" className={cn("size-4", mirrored && "rtl:-scale-x-100")} />
    </Button>
  );
}

export function TopBar({
  browse,
  actions,
  search,
  searchActions,
  searchInput,
}: {
  browse?: BrowseSnapshot;
  actions?: BrowseActions;
  search?: SearchSnapshot;
  searchActions?: SearchActions;
  /** The Search Bar's input, for Ctrl+E and Ctrl+F. */
  searchInput?: RefObject<HTMLInputElement | null>;
}) {
  // Each is disabled when there's nowhere to go (no history, or a drive or share root).
  const back = actions && browse?.canBack ? () => actions.back() : undefined;
  const forward = actions && browse?.canForward ? () => actions.forward() : undefined;
  const up = actions && browse?.place?.parent ? () => actions.up() : undefined;
  return (
    <header aria-label={t("topBar.label")} className="flex shrink-0 items-center gap-1 border-b px-3 py-2">
      <IconButton label="topBar.back" icon={ArrowLeft} mirrored onClick={back} />
      <IconButton label="topBar.forward" icon={ArrowRight} mirrored onClick={forward} />
      <IconButton label="topBar.up" icon={ArrowUp} onClick={up} />

      <Breadcrumb snapshot={browse} actions={actions} />

      <SearchBar
        // None while a folder loads: the listing kept on screen is the folder being left.
        folder={browse?.loading ? undefined : browse?.listing?.path}
        running={search?.running ?? false}
        actions={searchActions}
        input={searchInput}
      />

      <div className="ms-1">
        <IconButton label="topBar.settings" icon={Settings} />
      </div>
    </header>
  );
}

/**
 * Search Bar (UX-DR5): takes the remaining width up to 640px. Its 1px primary border becomes 2px on
 * focus, and that is its focus ring (no extra outline). Typing sends nothing; Enter searches the
 * listed folder (nothing without a listing, or with blank text). A spinner replaces the magnifier
 * while a search runs, and ✕ appears once there is text.
 */
function SearchBar({
  folder,
  running,
  actions,
  input,
}: {
  /** The listed folder's path; undefined while no folder is listed or one is loading. */
  folder?: string;
  running: boolean;
  actions?: SearchActions;
  input?: RefObject<HTMLInputElement | null>;
}) {
  const [text, setText] = useState("");
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (event.repeat) return; // a held Enter searches once
    if (text.trim() && folder !== undefined) actions?.search(text, folder);
  };
  const clear = () => {
    setText("");
    input?.current?.focus();
  };
  const Icon = running ? LoaderCircle : Search;
  return (
    <div className="ms-2 flex h-search min-w-0 flex-[2_1_0] items-center gap-2 rounded-md border border-primary bg-background px-3 [max-inline-size:640px] focus-within:ring-1 focus-within:ring-primary focus-within:ring-inset">
      <Icon
        aria-hidden="true"
        className={cn("size-4 shrink-0 text-muted-foreground", running && "animate-spin motion-reduce:animate-none")}
      />
      <input
        ref={input}
        type="text"
        dir="auto"
        spellCheck={false}
        autoComplete="off"
        aria-label={t("search.label")}
        aria-busy={running}
        placeholder={t("search.placeholder")}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
        className="min-w-0 flex-1 bg-transparent text-search outline-hidden placeholder:text-muted-foreground"
      />
      {text && (
        <button
          type="button"
          onClick={clear}
          aria-label={t("search.clear")}
          title={t("search.clear")}
          className="-me-1 inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      )}
    </div>
  );
}
