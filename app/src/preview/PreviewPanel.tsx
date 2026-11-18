import { useState } from "react";
import { ICONS } from "@/browse/rows";
import { LOCALE, t, type CatalogKey } from "@/i18n/catalog";
import { formatDate, formatSize, typeLabel } from "@/i18n/format";
import type { PreviewReady, ReadOutcomeCode } from "@/protocol/generated";
import type { PreviewItem, PreviewSnapshot } from "./session";

// The Preview Panel (FR-22, Story 2.5): the selected file's name, type, size and modified date, with
// a square thumbnail at the header row's inline end and the location below. The details show at
// once from the selected row; the thumbnail is a skeleton until the engine's previewReady arrives
// (no animation under reduced motion). The engine decides the thumbnail: the image itself (alt =
// the file name, object-fit contain), the first lines of a text file on a mini page, or a page shape
// with the type icon and extension; when it couldn't read the file, its outcome code is worded
// below. With no file selected, or a folder, the panel says "Select a file to preview" (EARS-02).
// Names and path segments are isolated with <bdi>; logical properties only, so the panel mirrors.
// The thumbnail's frame keeps its border in forced-colors mode.

const SEP = "\\";

// Typed so an outcome code without a sentence fails type-checking.
const OUTCOMES: Record<ReadOutcomeCode, CatalogKey> = {
  storedOnlyInOneDrive: "preview.storedOnlyInOneDrive",
  tooLarge: "preview.tooLarge",
  cannotRead: "preview.cannotRead",
};

type FileItem = Extract<PreviewItem, { kind: "file" }>;

/** The folder that holds `path`, as written: a drive root keeps its backslash. */
function folderOf(path: string): string {
  const cut = path.lastIndexOf(SEP);
  if (cut < 0) return path;
  const folder = path.slice(0, cut);
  return /^[A-Za-z]:$/.test(folder) ? folder + SEP : folder || path;
}

/** "PDF" for `report.pdf`, "GITIGNORE" for `.gitignore` (as the engine's `extension()`); "" without one. */
function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLocaleUpperCase(LOCALE) : "";
}

export function PreviewPanel({ item, preview }: { item: PreviewItem | null; preview?: PreviewSnapshot }) {
  if (!item || item.kind !== "file") {
    return (
      <aside
        aria-label={t("preview.label")}
        className="flex w-preview shrink-0 items-center justify-center overflow-auto border-s bg-surface-pane p-4"
      >
        <p className="text-center text-muted-foreground">{t("preview.empty")}</p>
      </aside>
    );
  }
  // Keyed on the path, so an image that failed to draw is forgotten with its file.
  return <FilePreview key={item.path} item={item} preview={preview?.path === item.path ? preview : undefined} />;
}

function FilePreview({ item, preview }: { item: FileItem; preview?: PreviewSnapshot }) {
  const [broken, setBroken] = useState<string | null>(null);
  const reply = preview?.reply ?? null;
  const thumbnail = reply?.thumbnail;
  const imageBroken = thumbnail?.kind === "image" && broken === thumbnail.data;
  const outcome: ReadOutcomeCode | null =
    preview?.failed || imageBroken ? "cannotRead" : (reply?.outcomeCode ?? null);
  // The reply's details are the file as it is now (and fill a name match's missing size); the
  // row's values show only until it arrives, or when there is none. The name stays the row's.
  const size = reply ? reply.details.size : item.size;
  const modified = formatDate(reply ? reply.details.modified : item.modified);

  return (
    <aside aria-label={t("preview.label")} className="w-preview shrink-0 overflow-auto border-s bg-surface-pane p-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-title [overflow-wrap:anywhere]">
            <bdi dir="auto">{item.name}</bdi>
          </h2>
          <dl className="mt-1 text-body-sm text-muted-foreground">
            <dt className="sr-only">{t("preview.type")}</dt>
            <dd>{typeLabel(item)}</dd>
            {size !== null && (
              <>
                <dt className="sr-only">{t("preview.size")}</dt>
                <dd>{formatSize(size)}</dd>
              </>
            )}
            {modified && (
              <>
                <dt className="sr-only">{t("preview.modified")}</dt>
                <dd>{modified}</dd>
              </>
            )}
          </dl>
        </div>
        <Thumbnail item={item} reply={reply} outcome={outcome} onBroken={setBroken} />
      </div>
      {outcome && (
        <p data-outcome="" className="mt-3 text-body-sm text-muted-foreground">
          {t(OUTCOMES[outcome])}
        </p>
      )}
      <dl className="mt-3 text-body-sm">
        <dt className="text-muted-foreground">{t("preview.location")}</dt>
        <dd className="[overflow-wrap:anywhere]">
          <Location folder={folderOf(item.path)} />
        </dd>
      </dl>
    </aside>
  );
}

/**
 * The square: 50% of the panel's content width, at least 96px and at most 192px (144px in the
 * 320px panel). A skeleton until the reply, then what the engine sent, or a page once it's clear
 * there is nothing else to show.
 */
function Thumbnail({
  item,
  reply,
  outcome,
  onBroken,
}: {
  item: FileItem;
  reply: PreviewReady | null;
  outcome: ReadOutcomeCode | null;
  onBroken: (data: string) => void;
}) {
  const thumbnail = reply?.thumbnail;
  let content;
  if (outcome !== null) {
    content = <Page item={item} />;
  } else if (!thumbnail) {
    content = <span data-skeleton="" className="block size-full bg-muted motion-safe:animate-pulse" />;
  } else if (thumbnail.kind === "image") {
    content = (
      <img
        src={`data:${thumbnail.mime};base64,${thumbnail.data}`}
        alt={item.name}
        className="size-full object-contain"
        onError={() => onBroken(thumbnail.data)}
      />
    );
  } else if (thumbnail.kind === "text") {
    content = (
      <div
        data-text=""
        dir="auto"
        className="size-full overflow-hidden px-2 py-1.5 text-[0.5rem] leading-snug whitespace-pre-wrap select-text [overflow-wrap:anywhere]"
      >
        {thumbnail.text}
      </div>
    );
  } else {
    content = <Page item={item} />;
  }
  return (
    <div
      data-thumbnail={outcome !== null ? "page" : (thumbnail?.kind ?? "loading")}
      aria-busy={!thumbnail && outcome === null}
      className="aspect-square w-[clamp(96px,50%,192px)] shrink-0 overflow-hidden rounded-md border bg-background forced-colors:border-[color:CanvasText]"
    >
      {content}
    </div>
  );
}

/** A page with the file's type icon and its extension in capitals: for every file with no image or text. */
function Page({ item }: { item: FileItem }) {
  const Icon = ICONS[item.typeCode];
  const ext = extensionOf(item.name);
  return (
    <div aria-hidden="true" className="flex size-full items-center justify-center bg-surface-pane">
      <div className="flex aspect-[3/4] h-4/5 flex-col items-center justify-center gap-1.5 rounded-sm border bg-background forced-colors:border-[color:CanvasText]">
        <Icon strokeWidth={1.5} className="size-8 text-muted-foreground" />
        {ext && (
          <span data-extension="" className="max-w-full truncate px-1 text-group-label text-muted-foreground">
            {ext}
          </span>
        )}
      </div>
    </div>
  );
}

/** The folder path, each segment isolated so Hebrew and English segments stay in path order. */
function Location({ folder }: { folder: string }) {
  const unc = folder.startsWith(SEP + SEP);
  const segments = folder.split(SEP).filter(Boolean);
  const root = folder.endsWith(SEP);
  return (
    <bdi dir="ltr" data-location="">
      {unc && SEP + SEP}
      {segments.map((segment, i) => (
        <span key={i}>
          {i > 0 && SEP}
          <bdi dir="auto">{segment}</bdi>
        </span>
      ))}
      {root && SEP}
    </bdi>
  );
}
