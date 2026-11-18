import { FilePlus } from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { catalog, t, type CatalogKey } from "@/i18n/catalog";
import type { CreateFileResult } from "./session";

// New file: a top-bar button that opens a small form under it for one name. Create sends the
// trimmed name to the engine, which checks it (no path, no reserved name) and never overwrites; its
// error code is worded from the catalog under the field, and the form stays open to fix the name.
// On success the form closes, focus returns to the button, and the browse session lists the folder
// again with the new file selected. Esc or Cancel closes it. The form belongs to the folder that was
// listed when it opened: navigating to another folder closes it.

/** The catalog sentence for a createFile error code. */
function errorKey(code: string): CatalogKey {
  const key = `newFile.${code}`;
  return key in catalog ? (key as CatalogKey) : "newFile.failed";
}

export function NewFile({
  folder,
  onCreate,
}: {
  /** The listed folder; undefined while none is listed (or one is loading), which disables the button. */
  folder?: string;
  onCreate?: (folder: string, name: string) => Promise<CreateFileResult>;
}) {
  const [target, setTarget] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<CatalogKey | null>(null);
  const [busy, setBusy] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const formId = useId();
  const errorId = useId();
  const open = target !== null;

  const close = (refocus: boolean) => {
    setTarget(null);
    setName("");
    setError(null);
    if (refocus) button.current?.focus();
  };

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  // Another folder was listed: the form no longer names where the file would go.
  useEffect(() => {
    if (target !== null && folder !== undefined && folder !== target) close(false);
  }, [folder, target]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (target === null || !trimmed || busy || !onCreate) return;
    setBusy(true);
    setError(null);
    onCreate(target, trimmed)
      .then((result) => {
        if (result.created) {
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
    // Handled here, so the window's Esc doesn't also leave a search view.
    event.preventDefault();
    event.stopPropagation();
    // A file on its way can't be called back: the form waits for its result, not hides it.
    if (!busy) close(true);
  };

  const enabled = folder !== undefined && onCreate !== undefined;
  return (
    <div className="relative ms-1">
      <Button
        ref={button}
        variant="ghost"
        size="sm"
        disabled={!enabled}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? formId : undefined}
        title={t("newFile.button")}
        onClick={() => (open ? !busy && close(true) : folder !== undefined && setTarget(folder))}
      >
        <FilePlus aria-hidden="true" className="size-4" />
        {t("newFile.button")}
      </Button>
      {open && (
        <form
          id={formId}
          role="dialog"
          aria-label={t("newFile.dialog")}
          onSubmit={submit}
          onKeyDown={onKeyDown}
          className="absolute end-0 top-full z-20 mt-1 flex w-80 flex-col gap-2 rounded-md border bg-background p-3 shadow-md"
        >
          <label className="flex flex-col gap-1 text-body-sm">
            {t("newFile.name")}
            <input
              ref={input}
              type="text"
              dir="auto"
              spellCheck={false}
              autoComplete="off"
              value={name}
              aria-invalid={error !== null}
              aria-describedby={error ? errorId : undefined}
              onChange={(event) => {
                setName(event.target.value);
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
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => close(true)}>
              {t("newFile.cancel")}
            </Button>
            <Button type="submit" size="sm" disabled={!name.trim() || busy}>
              {t("newFile.create")}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
