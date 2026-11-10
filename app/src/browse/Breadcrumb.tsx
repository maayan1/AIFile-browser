import { ChevronRight } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { t } from "@/i18n/catalog";
import { folderErrorKey, segmentName } from "@/i18n/format";
import { cn } from "@/lib/utils";
import type { BrowseActions, BrowseSnapshot } from "./session";

// The breadcrumb bar (FR-2, UX-DR4). Segments come from the engine in real path order; each is a
// button isolated with <bdi dir="auto">, and the chevrons between them mirror under rtl. A click
// on the empty area or Alt+D turns the bar into a path field with the whole path selected: Enter
// opens the typed path, Esc or leaving the field cancels. A typed path that fails keeps the field
// open with the reason under it, and the current folder stays on screen.

const EDIT_KEY = "KeyD";

export function Breadcrumb({ snapshot, actions }: { snapshot?: BrowseSnapshot; actions?: BrowseActions }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  /** Enter was pressed: the next listing means the typed path opened, so the field closes. */
  const submitted = useRef(false);
  /**
   * Enter was pressed during this edit. An error only belongs to a path typed in this edit: a
   * slow path that fails after the field was left must not greet the next Alt+D.
   */
  const [tried, setTried] = useState(false);
  const errorId = useId();

  const listing = snapshot?.listing ?? null;
  // A folder that exists but can't be listed still has a place, so its segments still show.
  const place = snapshot?.place ?? null;
  const location = snapshot?.location ?? place?.path ?? "";
  const pathError = editing && tried ? (snapshot?.pathError ?? null) : null;

  function startEditing() {
    if (editing) {
      input.current?.select();
      return;
    }
    const active = document.activeElement;
    returnFocus.current = active instanceof HTMLElement && active !== document.body ? active : null;
    submitted.current = false;
    setTried(false);
    actions?.clearPathError();
    setText(location);
    setEditing(true);
  }

  function stopEditing(restoreFocus: boolean) {
    submitted.current = false;
    setEditing(false);
    actions?.clearPathError();
    const target = returnFocus.current;
    returnFocus.current = null;
    if (restoreFocus && target?.isConnected) target.focus();
  }

  // Alt+D from anywhere in the window lives here; the other window shortcuts are in shortcuts.ts.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && event.code === EDIT_KEY) {
        event.preventDefault();
        startEditing();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  useEffect(() => {
    if (!editing) return;
    input.current?.focus();
    input.current?.select();
  }, [editing]);

  // A new listing after Enter means the typed path opened; only that closes the field.
  useEffect(() => {
    if (editing && submitted.current) stopEditing(true);
  }, [listing]);

  // A failed typed path leaves the field open for another try.
  useEffect(() => {
    if (pathError) submitted.current = false;
  }, [pathError]);

  return (
    <div
      role="group"
      aria-label={t("breadcrumb.label")}
      onClick={(event) => {
        if (event.target === event.currentTarget) startEditing();
      }}
      className={cn(
        "relative ms-1 flex h-9 min-w-40 flex-[1_1_0] items-center rounded-sm border border-input bg-background text-[0.875rem]",
        editing && "border-primary ring-1 ring-primary ring-inset",
      )}
    >
      {editing ? (
        <>
          <input
            ref={input}
            type="text"
            dir="auto"
            spellCheck={false}
            autoComplete="off"
            aria-label={t("breadcrumb.field")}
            aria-invalid={pathError ? true : undefined}
            aria-describedby={pathError ? errorId : undefined}
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              actions?.clearPathError();
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                if (text === "") return;
                submitted.current = true;
                setTried(true);
                actions?.openTyped(text);
              } else if (event.key === "Escape") {
                event.preventDefault();
                stopEditing(true);
              }
            }}
            onBlur={() => stopEditing(false)}
            className="h-full w-full min-w-0 bg-transparent px-2.5 outline-hidden"
          />
          {pathError && (
            <p
              id={errorId}
              role="alert"
              className="absolute start-0 top-full z-20 mt-1 rounded-lg border bg-popover px-3 py-2 text-body-sm text-popover-foreground shadow-md"
            >
              {t(folderErrorKey(pathError))}
            </p>
          )}
        </>
      ) : (
        <>
          {place ? (
            <ol className="flex min-w-0 items-center overflow-hidden ps-1">
              {place.segments.map((segment, i) => (
                <li key={segment.path} className="flex min-w-0 items-center">
                  {i > 0 && (
                    <ChevronRight
                      aria-hidden="true"
                      className="mx-0.5 size-3.5 shrink-0 text-muted-foreground rtl:-scale-x-100"
                    />
                  )}
                  <button
                    type="button"
                    aria-current={i === place.segments.length - 1 ? "location" : undefined}
                    onClick={() => actions?.open(segment.path)}
                    className="min-w-0 truncate rounded-sm px-1.5 py-0.5 hover:bg-accent hover:text-accent-foreground focus-visible:outline-offset-[-2px]"
                  >
                    <bdi dir="auto">{segmentName(segment)}</bdi>
                  </button>
                </li>
              ))}
            </ol>
          ) : (
            location && (
              <bdi dir="auto" className="min-w-0 truncate px-2.5 text-muted-foreground">
                {location}
              </bdi>
            )
          )}
          {/* The empty area: a click here edits the path. */}
          <span aria-hidden="true" data-empty-area="" onClick={startEditing} className="h-full min-w-4 flex-1" />
        </>
      )}
    </div>
  );
}
