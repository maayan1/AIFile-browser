import { ArrowLeft, ArrowRight, ArrowUp, Search, Settings } from "lucide-react";
import type { ComponentType } from "react";
import { Breadcrumb } from "@/browse/Breadcrumb";
import type { BrowseActions, BrowseSnapshot } from "@/browse/session";
import { Button } from "@/components/ui/button";
import { t, type CatalogKey } from "@/i18n/catalog";
import { cn } from "@/lib/utils";

// Top bar (UX-DR4). Back, Forward and Up follow the browse session (1.5); search arrives in
// Epic 2 and Search folders in Epic 3, so those stay inert. Back and forward mirror under
// `dir="rtl"`; up and the gear have no direction.
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

export function TopBar({ browse, actions }: { browse?: BrowseSnapshot; actions?: BrowseActions }) {
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

      {/* Search Bar (UX-DR5): takes the remaining width up to 640px. Its 1px primary border
          becomes 2px on focus, and that is its focus ring (no extra outline). */}
      <div className="ms-2 flex h-search min-w-0 flex-[2_1_0] items-center gap-2 rounded-md border border-primary bg-background px-3 [max-inline-size:640px] focus-within:ring-1 focus-within:ring-primary focus-within:ring-inset">
        <Search aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        <input
          type="text"
          dir="auto"
          spellCheck={false}
          autoComplete="off"
          aria-label={t("search.label")}
          placeholder={t("search.placeholder")}
          className="min-w-0 flex-1 bg-transparent text-search outline-hidden placeholder:text-muted-foreground"
        />
      </div>

      <div className="ms-1">
        <IconButton label="topBar.settings" icon={Settings} />
      </div>
    </header>
  );
}
