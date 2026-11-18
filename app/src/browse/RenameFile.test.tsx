// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "@/i18n/catalog";
import type { FolderListing } from "@/protocol/generated";
import { BrowseList } from "./BrowseList";
import { RenameFile, stemEnd } from "./RenameFile";
import { INITIAL_SNAPSHOT, type BrowseActions, type RenameFileResult } from "./session";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

const DOCS = "C:\\Users\\dana\\Documents";

const dialog = () => screen.getByRole("dialog", { name: t("rename.dialog") });
const nameField = () => screen.getByRole<HTMLInputElement>("textbox", { name: t("rename.name") });
const renameButton = () => screen.getByRole<HTMLButtonElement>("button", { name: t("rename.save") });

/** A focusable stand-in for the file's row, in the page. */
function makeRow(): HTMLElement {
  const row = document.createElement("div");
  row.tabIndex = -1;
  document.body.append(row);
  return row;
}

function setup(result: RenameFileResult = { renamed: true, path: `${DOCS}\\x.txt` }, name = "notes.txt") {
  const row = makeRow();
  const onRename = vi.fn(async (_folder: string, _name: string, _newName: string) => result);
  const onClose = vi.fn<(renamed: boolean) => void>();
  render(<RenameFile folder={DOCS} name={name} row={row} onRename={onRename} onClose={onClose} />);
  return { row, onRename, onClose };
}

describe("stemEnd", () => {
  it.each([
    ["notes.txt", 5],
    ["archive.tar.gz", 11],
    [".gitignore", 10],
    ["README", 6],
    ["סיכום ישיבה.docx", 11],
  ])("selects up to the extension of %s", (name, end) => {
    expect(stemEnd(name)).toBe(end);
  });
});

describe("RenameFile", () => {
  it("opens with the current name, the part before the extension selected and focused", () => {
    setup();
    expect(dialog()).toBeTruthy();
    expect(nameField().value).toBe("notes.txt");
    expect(document.activeElement).toBe(nameField());
    expect([nameField().selectionStart, nameField().selectionEnd]).toEqual([0, 5]);
    expect(nameField().getAttribute("dir")).toBe("auto");
  });

  it("renames to the trimmed name in the listed folder, then closes as renamed", async () => {
    const { onRename, onClose } = setup();
    fireEvent.change(nameField(), { target: { value: "  סיכום.txt " } });
    fireEvent.submit(dialog());
    expect(onRename).toHaveBeenCalledExactlyOnceWith(DOCS, "notes.txt", "סיכום.txt");
    await waitFor(() => expect(onClose).toHaveBeenCalledExactlyOnceWith(true));
  });

  it("closes without asking the engine when the name didn't change, and refocuses the row", () => {
    const { row, onRename, onClose } = setup();
    fireEvent.change(nameField(), { target: { value: " notes.txt  " } });
    fireEvent.submit(dialog());
    expect(onRename).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledExactlyOnceWith(false);
    expect(document.activeElement).toBe(row);
  });

  it("changes nothing for an untouched name the disk holds with a leading space", () => {
    const { onRename, onClose } = setup(undefined, " notes.txt");
    fireEvent.submit(dialog());
    expect(onRename).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledExactlyOnceWith(false);
  });

  it("stays open on Esc and Cancel while the rename runs: it can't be called back", () => {
    const row = makeRow();
    const onRename = vi.fn(() => new Promise<RenameFileResult>(() => {}));
    const onClose = vi.fn();
    render(<RenameFile folder={DOCS} name="notes.txt" row={row} onRename={onRename} onClose={onClose} />);
    fireEvent.change(nameField(), { target: { value: "x.txt" } });
    fireEvent.submit(dialog());
    fireEvent.keyDown(nameField(), { key: "Escape" });
    expect(screen.getByRole<HTMLButtonElement>("button", { name: t("rename.cancel") }).disabled).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
    expect(dialog()).toBeTruthy();
  });

  it("keeps Rename disabled while the name is empty or spaces", () => {
    const { onRename } = setup();
    fireEvent.change(nameField(), { target: { value: "   " } });
    expect(renameButton().disabled).toBe(true);
    fireEvent.submit(dialog());
    expect(onRename).not.toHaveBeenCalled();
  });

  it("sends one request while one is running", () => {
    const row = makeRow();
    const onRename = vi.fn(() => new Promise<RenameFileResult>(() => {}));
    render(<RenameFile folder={DOCS} name="notes.txt" row={row} onRename={onRename} onClose={vi.fn()} />);
    fireEvent.change(nameField(), { target: { value: "x.txt" } });
    fireEvent.submit(dialog());
    fireEvent.submit(dialog());
    expect(onRename).toHaveBeenCalledTimes(1);
    expect(renameButton().disabled).toBe(true);
  });

  it.each([
    ["fileExists", "rename.fileExists"],
    ["fileInUse", "rename.fileInUse"],
    ["fileNotFound", "rename.fileNotFound"],
    ["invalidName", "rename.invalidName"],
    ["accessDenied", "rename.accessDenied"],
    ["folderUnavailable", "rename.folderUnavailable"],
    ["somethingNew", "rename.failed"],
  ] as const)("words a %s refusal under the field and stays open to fix the name", async (code, key) => {
    const { onClose } = setup({ renamed: false, code });
    fireEvent.change(nameField(), { target: { value: "x.txt" } });
    fireEvent.click(renameButton());
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(t(key));
    expect(nameField().getAttribute("aria-invalid")).toBe("true");
    expect(nameField().getAttribute("aria-describedby")).toBe(alert.id);
    expect(nameField().value).toBe("x.txt");
    expect(onClose).not.toHaveBeenCalled();
    // Typing again clears the sentence.
    fireEvent.change(nameField(), { target: { value: "y.txt" } });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("closes on Esc without the window seeing it, and refocuses the row; not during an IME composition", () => {
    const { row, onRename, onClose } = setup();
    const windowKeys = vi.fn();
    window.addEventListener("keydown", windowKeys);
    try {
      fireEvent.keyDown(nameField(), { key: "Escape", isComposing: true });
      expect(onClose).not.toHaveBeenCalled();
      fireEvent.keyDown(nameField(), { key: "Escape" });
      expect(onClose).toHaveBeenCalledExactlyOnceWith(false);
      expect(document.activeElement).toBe(row);
      expect(windowKeys.mock.calls.some(([event]) => (event as KeyboardEvent).key === "Escape" && !(event as KeyboardEvent).isComposing)).toBe(false);
      expect(onRename).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", windowKeys);
    }
  });

  it("closes on Cancel without renaming anything", () => {
    const { row, onRename, onClose } = setup();
    fireEvent.click(screen.getByRole("button", { name: t("rename.cancel") }));
    expect(onClose).toHaveBeenCalledExactlyOnceWith(false);
    expect(onRename).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(row);
  });
});

describe("BrowseList Rename", () => {
  const listingOf = (path: string, names: string[]): FolderListing => ({
    id: "u1",
    type: "folderListing",
    path,
    parent: "C:\\Users\\dana",
    segments: [{ kind: "knownFolder", code: "documents", path }],
    entries: [
      { name: "Photos", kind: "folder", modified: null },
      ...names.map((name) => ({ name, kind: "file" as const, typeCode: "pdf" as const, size: 1, modified: null })),
    ],
  });
  const LISTING = listingOf(DOCS, ["Budget תקציב.pdf", "other.pdf"]);
  const row = (name: string) => screen.getByText(name).closest("tr")!;

  function setup() {
    const renameFile = vi.fn<BrowseActions["renameFile"]>(async () => ({ renamed: true, path: `${DOCS}\\new.pdf` }));
    const actions = { renameFile, showInFolder: vi.fn(), open: vi.fn(), openFile: vi.fn() } as unknown as BrowseActions;
    const view = render(<BrowseList snapshot={{ ...INITIAL_SNAPSHOT, listing: LISTING, location: DOCS }} actions={actions} />);
    const show = (listing: FolderListing) =>
      view.rerender(<BrowseList snapshot={{ ...INITIAL_SNAPSHOT, listing, location: listing.path }} actions={actions} />);
    return { renameFile, show };
  }

  it("F2 on a file row opens Rename for that file, and Rename asks the session", async () => {
    const { renameFile } = setup();
    fireEvent.keyDown(row("Budget תקציב.pdf"), { key: "F2" });
    expect(nameField().value).toBe("Budget תקציב.pdf");
    expect(row("Budget תקציב.pdf").getAttribute("aria-selected")).toBe("true");
    fireEvent.change(nameField(), { target: { value: "new.pdf" } });
    fireEvent.submit(dialog());
    expect(renameFile).toHaveBeenCalledExactlyOnceWith(DOCS, "Budget תקציב.pdf", "new.pdf");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("Rename opened on another file starts with that file's name, never the text typed for the first", () => {
    const { renameFile } = setup();
    fireEvent.keyDown(row("other.pdf"), { key: "F2" });
    fireEvent.change(nameField(), { target: { value: "typed for other.pdf" } });
    fireEvent.keyDown(row("Budget תקציב.pdf"), { key: "F2" });
    expect(nameField().value).toBe("Budget תקציב.pdf");
    fireEvent.submit(dialog());
    expect(renameFile).not.toHaveBeenCalled();
  });

  it("never opens Rename for a folder, nor on a held F2 or a modified one", () => {
    setup();
    fireEvent.keyDown(row("Photos"), { key: "F2" });
    fireEvent.keyDown(row("other.pdf"), { key: "F2", repeat: true });
    fireEvent.keyDown(row("other.pdf"), { key: "F2", shiftKey: true });
    fireEvent.keyDown(row("other.pdf"), { key: "F2", ctrlKey: true });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("the row menu's Rename opens the form for its file", () => {
    setup();
    fireEvent.contextMenu(row("other.pdf"), { button: 2, clientX: 1, clientY: 1 });
    fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: t("menu.rename") }));
    expect(screen.queryByRole("menu")).toBeNull();
    expect(nameField().value).toBe("other.pdf");
    expect(document.activeElement).toBe(nameField());
  });

  it("closes when another folder is listed, or when the file is gone from a re-list", () => {
    const { show } = setup();
    fireEvent.keyDown(row("other.pdf"), { key: "F2" });
    show(listingOf(DOCS, ["Budget תקציב.pdf", "other.pdf"])); // F5: still there, stays open
    expect(screen.queryByRole("dialog")).not.toBeNull();
    show(listingOf(DOCS, ["Budget תקציב.pdf"]));
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.keyDown(row("Budget תקציב.pdf"), { key: "F2" });
    show(listingOf(`${DOCS}\\Work`, ["Budget תקציב.pdf"]));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
