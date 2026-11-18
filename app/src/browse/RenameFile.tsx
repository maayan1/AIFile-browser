import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { catalog, t, type CatalogKey } from "@/i18n/catalog";
import { atRow } from "./rows";
import type { MenuPosition } from "./RowMenu";
import type { RenameFileResult } from "./session";

// Rename: a small form just below the file's row, opened from the row menu or with F2. It starts
// with the current name and the part before the extension selected, as in File Explorer, so typing
// replaces the name and keeps the extension. Rename sends the trimmed name to the engine, which
// checks it (one name, no reserved name), renames files only, in their own folder, and never
// overwrites; its error code is worded from the catalog under the field, and the form stays open to
// fix the name. The same name closes the form without asking the engine: nothing would change. On
// success the form closes and the browse session lists the folder again with the file selected
// (the list then focuses that row). Esc or Cancel closes it and hands focus back to the row. It
// follows its row when the list scrolls.

/** The catalog sentence for a renameFile error code. */
function errorKey(code: string): CatalogKey {
  const key = `rename.${code}`;
  return key in catalog ? (key as CatalogKey) : "rename.failed";
}

/** The end of the part a rename usually replaces: before the last dot, unless the name starts with it. */
export function stemEnd(name: string): number {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? dot : name.length;
}

export function RenameFile({
  folder,
  name,
  row,
  onRename,
  onClose,
}: {
  /** The listed folder that holds the file. */
  folder: string;
  /** The file's current name. */
  name: string;
  /** The file's row: the form opens below it, and focus goes back to it on Esc or Cancel. */
  row: HTMLElement;
  onRename: (folder: string, name: string, newName: string) => Promise<RenameFileResult>;
  /** Closes the form; `renamed` when the file got its new name (the refresh then moves focus). */
  onClose: (renamed: boolean) => void;
}) {
  const [value, setValue] = useState(name);
  const [error, setError] = useState<CatalogKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [position, setPosition] = useState<MenuPosition>(() => atRow(row));
  const form = useRef<HTMLFormElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const errorId = useId();

  useEffect(() => {
    input.current?.focus();
    input.current?.setSelectionRange(0, stemEnd(name));
  }, [name]);

  // Stays under its row while the list scrolls or the window resizes, and inside the viewport.
  useLayoutEffect(() => {
    const place = () => {
      const at = atRow(row);
      const box = form.current;
      if (!box) return setPosition(at);
      const below = at.top + box.offsetHeight <= window.innerHeight;
      setPosition({
        top: below ? at.top : Math.max(0, row.getBoundingClientRect().top - box.offsetHeight),
        inlineStart: Math.max(0, Math.min(at.inlineStart, window.innerWidth - box.offsetWidth)),
      });
    };
    place();
    document.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      document.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [row]);

  const close = (renamed: boolean) => {
    if (!renamed && row.isConnected) row.focus({ preventScroll: true });
    onClose(renamed);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = value.trim();
    if (!trimmed || busy) return;
    if (trimmed === name) {
      close(false);
      return;
    }
    setBusy(true);
    setError(null);
    onRename(folder, name, trimmed)
      .then((result) => {
        if (result.renamed) {
          close(true);
          return;
        }
        setError(errorKey(result.code));
        input.current?.select();
      })
      .finally(() => setBusy(false));
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    event.stopPropagation();
    close(false);
  };

  return (
    <form
      ref={form}
      role="dialog"
      aria-label={t("rename.dialog")}
      onSubmit={submit}
      onKeyDown={onKeyDown}
      style={{ top: position.top, insetInlineStart: position.inlineStart }}
      className="fixed z-50 flex w-80 flex-col gap-2 rounded-md border bg-background p-3 shadow-md"
    >
      <label className="flex flex-col gap-1 text-body-sm">
        {t("rename.name")}
        <input
          ref={input}
          type="text"
          dir="auto"
          spellCheck={false}
          autoComplete="off"
          value={value}
          aria-invalid={error !== null}
          aria-describedby={error ? errorId : undefined}
          onChange={(event) => {
            setValue(event.target.value);
            setError(null);
          }}
          className="h-8 rounded-sm border bg-background px-2 outline-hidden focus:border-primary"
        />
      </label>
      {error && (
        <p id={errorId} role="alert" className="text-body-sm text-destructive">
          {t(error)}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={() => close(false)}>
          {t("rename.cancel")}
        </Button>
        <Button type="submit" size="sm" disabled={!value.trim() || busy}>
          {t("rename.save")}
        </Button>
      </div>
    </form>
  );
}
