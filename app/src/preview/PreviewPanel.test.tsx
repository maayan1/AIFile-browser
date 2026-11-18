// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { t } from "@/i18n/catalog";
import type { PreviewReady } from "@/protocol/generated";
import { PreviewPanel } from "./PreviewPanel";
import type { PreviewItem, PreviewSnapshot } from "./session";

afterEach(cleanup);

const VOL = "C:\\Users\\dana\\Documents\\התנדבות";
const OCT_14 = "2025-10-14T12:00:00+00:00";

function file(name: string, change: Partial<Extract<PreviewItem, { kind: "file" }>> = {}): PreviewItem {
  return { kind: "file", path: `${VOL}\\${name}`, name, typeCode: "pdf", size: 215_040, modified: OCT_14, ...change };
}

function reply(item: PreviewItem, thumbnail: PreviewReady["thumbnail"], change: Partial<PreviewReady> = {}): PreviewReady {
  if (item.kind !== "file") throw new Error("a file");
  return {
    id: "p1",
    type: "previewReady",
    details: { name: item.name, path: item.path, typeCode: item.typeCode, size: item.size ?? 70, modified: item.modified },
    thumbnail,
    ...change,
  };
}

const loading = (item: PreviewItem): PreviewSnapshot => ({ path: item.path, reply: null, loading: true, failed: false });
const done = (r: PreviewReady): PreviewSnapshot => ({ path: r.details.path, reply: r, loading: false, failed: false });

const panel = () => screen.getByRole("complementary", { name: t("preview.label") });
const thumbnail = () => panel().querySelector<HTMLElement>("[data-thumbnail]")!;
const outcome = () => panel().querySelector("[data-outcome]")?.textContent ?? null;

describe("PreviewPanel", () => {
  it("says Select a file to preview with nothing selected or a folder selected (EARS-02)", () => {
    const { rerender } = render(<PreviewPanel item={null} />);
    expect(panel().textContent).toBe(t("preview.empty"));
    rerender(<PreviewPanel item={{ kind: "folder", path: `${VOL}\\Photos`, name: "Photos", modified: null }} />);
    expect(panel().textContent).toBe(t("preview.empty"));
    expect(thumbnail()).toBeNull();
  });

  it("shows the details at once and a skeleton for the thumbnail, still under reduced motion", () => {
    const item = file("Budget תקציב.pdf");
    render(<PreviewPanel item={item} preview={loading(item)} />);
    const title = screen.getByRole("heading", { level: 2 });
    expect(title.className).toContain("text-title");
    const name = title.querySelector("bdi")!;
    expect(name.getAttribute("dir")).toBe("auto");
    expect(name.textContent).toBe("Budget תקציב.pdf");
    expect(panel().textContent).toContain("PDF document");
    expect(panel().textContent).toContain("210 KB");
    expect(panel().textContent).toContain("Oct 14, 2025");
    expect(thumbnail().dataset.thumbnail).toBe("loading");
    expect(thumbnail().getAttribute("aria-busy")).toBe("true");
    const skeleton = thumbnail().querySelector<HTMLElement>("[data-skeleton]")!;
    // No animation under reduced motion: it pulses only when motion is allowed.
    expect(skeleton.className.split(" ")).toContain("motion-safe:animate-pulse");
    expect(skeleton.className.split(" ")).not.toContain("animate-pulse");
  });

  it("draws the thumbnail as a square at the header row's end, about 144px in the 320px panel", () => {
    const item = file("report.pdf");
    render(<PreviewPanel item={item} preview={loading(item)} />);
    const square = thumbnail();
    const classes = square.className.split(" ");
    expect(classes).toContain("aspect-square");
    expect(classes).toContain("w-[clamp(96px,50%,192px)]");
    expect(classes).toContain("shrink-0");
    // After the details in the header row, so it sits at the inline end (the right in English).
    const header = square.parentElement!;
    expect(header.className.split(" ")).toContain("flex");
    expect(header.lastElementChild).toBe(square);
    expect(header.firstElementChild!.contains(screen.getByRole("heading", { level: 2 }))).toBe(true);
    // The location comes below the header row.
    const location = panel().querySelector("[data-location]")!;
    expect(header.compareDocumentPosition(location) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Its border stays visible in forced-colors mode.
    expect(classes).toContain("border");
    expect(classes).toContain("forced-colors:border-[color:CanvasText]");
  });

  it("shows an image reply as the image itself, named by its alt and contained in the square", () => {
    const item = file("photo.png", { typeCode: "image" });
    const r = reply(item, { kind: "image", mime: "image/png", data: "iVBORw0KGgo=" });
    render(<PreviewPanel item={item} preview={done(r)} />);
    const img = screen.getByRole("img", { name: "photo.png" });
    expect(img.getAttribute("src")).toBe("data:image/png;base64,iVBORw0KGgo=");
    expect(img.className.split(" ")).toContain("object-contain");
    expect(thumbnail().dataset.thumbnail).toBe("image");
    expect(outcome()).toBeNull();
  });

  it("falls back to a page and This file can't be read when the image fails to draw", () => {
    const item = file("photo.png", { typeCode: "image" });
    render(<PreviewPanel item={item} preview={done(reply(item, { kind: "image", mime: "image/png", data: "bad" }))} />);
    fireEvent.error(screen.getByRole("img", { name: "photo.png" }));
    expect(screen.queryByRole("img", { name: "photo.png" })).toBeNull();
    expect(thumbnail().dataset.thumbnail).toBe("page");
    expect(outcome()).toBe(t("preview.cannotRead"));
  });

  it("shows a text reply's first lines on a mini page, in their own direction", () => {
    const item = file("סיכום.md", { typeCode: "markdown" });
    render(<PreviewPanel item={item} preview={done(reply(item, { kind: "text", text: "# כותרת\nline two" }))} />);
    const text = thumbnail().querySelector<HTMLElement>("[data-text]")!;
    expect(text.textContent).toBe("# כותרת\nline two");
    expect(text.getAttribute("dir")).toBe("auto");
    expect(text.className.split(" ")).toContain("whitespace-pre-wrap");
  });

  it("shows other types as a page with the type icon and the extension in capitals", () => {
    const item = file("Budget תקציב.pdf");
    render(<PreviewPanel item={item} preview={done(reply(item, { kind: "page" }))} />);
    expect(thumbnail().dataset.thumbnail).toBe("page");
    expect(thumbnail().querySelector("svg")).not.toBeNull();
    expect(thumbnail().querySelector("[data-extension]")!.textContent).toBe("PDF");
    expect(outcome()).toBeNull();
  });

  it("shows a page with no extension label for a file without one", () => {
    const item = file("README", { typeCode: "other" });
    render(<PreviewPanel item={item} preview={done(reply(item, { kind: "page" }))} />);
    expect(thumbnail().querySelector("[data-extension]")).toBeNull();
  });

  it.each([
    ["tooLarge", "preview.tooLarge"],
    ["storedOnlyInOneDrive", "preview.storedOnlyInOneDrive"],
    ["cannotRead", "preview.cannotRead"],
  ] as const)("words the %s outcome under a page", (code, key) => {
    const item = file("big.jpg", { typeCode: "image" });
    render(<PreviewPanel item={item} preview={done(reply(item, { kind: "page" }, { outcomeCode: code }))} />);
    expect(thumbnail().dataset.thumbnail).toBe("page");
    expect(outcome()).toBe(t(key));
  });

  it("says This file can't be read when the request failed (an engine restart)", () => {
    const item = file("notes.txt", { typeCode: "text" });
    render(<PreviewPanel item={item} preview={{ path: item.path, reply: null, loading: false, failed: true }} />);
    expect(thumbnail().dataset.thumbnail).toBe("page");
    expect(outcome()).toBe(t("preview.cannotRead"));
  });

  it("keeps the skeleton while the snapshot is still another file's", () => {
    const item = file("b.txt", { typeCode: "text" });
    const other = file("a.txt", { typeCode: "text" });
    render(<PreviewPanel item={item} preview={done(reply(other, { kind: "text", text: "not mine" }))} />);
    expect(thumbnail().dataset.thumbnail).toBe("loading");
    expect(panel().textContent).not.toContain("not mine");
  });

  it("fills a name match's unknown size from the reply's details", () => {
    const item = file("report.pdf", { size: null });
    const { rerender } = render(<PreviewPanel item={item} preview={loading(item)} />);
    expect(panel().textContent).not.toContain("KB");
    const r = reply(item, { kind: "page" });
    rerender(<PreviewPanel item={item} preview={done({ ...r, details: { ...r.details, size: 38_912 } })} />);
    expect(panel().textContent).toContain("38 KB");
  });

  it("shows the reply's fresh size and date over the row's, and keeps the row's name", () => {
    const item = file("report.pdf", { size: 1024, modified: OCT_14 });
    const { rerender } = render(<PreviewPanel item={item} preview={loading(item)} />);
    expect(panel().textContent).toContain("1 KB");
    expect(panel().textContent).toContain("Oct 14, 2025");
    const r = reply(item, { kind: "page" });
    const fresh = { ...r, details: { ...r.details, name: "REPORT.pdf", size: 38_912, modified: "2025-11-02T12:00:00+00:00" } };
    rerender(<PreviewPanel item={item} preview={done(fresh)} />);
    expect(panel().textContent).toContain("38 KB");
    expect(panel().textContent).toContain("Nov 2, 2025");
    expect(panel().textContent).not.toContain("Oct 14, 2025");
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("report.pdf");
  });

  it("keeps the row's size and date when the request failed", () => {
    const item = file("report.pdf", { size: 1024, modified: OCT_14 });
    render(<PreviewPanel item={item} preview={{ path: item.path, reply: null, loading: false, failed: true }} />);
    expect(panel().textContent).toContain("1 KB");
    expect(panel().textContent).toContain("Oct 14, 2025");
  });

  it("labels a dot-file's page with its extension, as the engine reads it", () => {
    const item = file(".gitignore", { typeCode: "other" });
    render(<PreviewPanel item={item} preview={done(reply(item, { kind: "page" }))} />);
    expect(thumbnail().querySelector("[data-extension]")!.textContent).toBe("GITIGNORE");
  });

  it("isolates each location segment, in path order", () => {
    const item = file("report.pdf");
    render(<PreviewPanel item={item} />);
    const location = panel().querySelector("[data-location]")!;
    expect(location.getAttribute("dir")).toBe("ltr");
    const segments = [...location.querySelectorAll("bdi")].map((b) => [b.textContent, b.getAttribute("dir")]);
    expect(segments).toEqual([
      ["C:", "auto"],
      ["Users", "auto"],
      ["dana", "auto"],
      ["Documents", "auto"],
      ["התנדבות", "auto"],
    ]);
    expect(location.textContent).toBe(VOL);
  });

  it("writes a drive root and a share as they are", () => {
    const { rerender } = render(<PreviewPanel item={{ ...file("a.pdf"), path: "C:\\a.pdf" }} />);
    expect(panel().querySelector("[data-location]")!.textContent).toBe("C:\\");
    rerender(<PreviewPanel item={{ ...file("a.pdf"), path: "\\\\server\\share\\a.pdf" }} />);
    expect(panel().querySelector("[data-location]")!.textContent).toBe("\\\\server\\share");
  });
});
