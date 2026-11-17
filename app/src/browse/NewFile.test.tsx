// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "@/i18n/catalog";
import { NewFile } from "./NewFile";
import type { CreateFileResult } from "./session";

afterEach(cleanup);

const DOCS = "C:\\Users\\dana\\Documents";

const newFileButton = () => screen.getByRole<HTMLButtonElement>("button", { name: t("newFile.button") });
const nameField = () => screen.getByRole<HTMLInputElement>("textbox", { name: t("newFile.name") });
const createButton = () => screen.getByRole<HTMLButtonElement>("button", { name: t("newFile.create") });

function setup(result: CreateFileResult = { created: true, path: `${DOCS}\\notes.txt` }) {
  const onCreate = vi.fn(async (_folder: string, _name: string) => result);
  const view = render(<NewFile folder={DOCS} onCreate={onCreate} />);
  fireEvent.click(newFileButton());
  return { onCreate, ...view };
}

describe("NewFile", () => {
  it("is disabled while no folder is listed", () => {
    render(<NewFile onCreate={vi.fn()} />);
    expect(newFileButton().disabled).toBe(true);
    expect(newFileButton().title).toBe(t("newFile.button"));
  });

  it("opens a form with the name field focused and Create disabled until a name is typed", () => {
    setup();
    expect(screen.getByRole("dialog", { name: t("newFile.dialog") })).toBeTruthy();
    expect(newFileButton().getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(nameField());
    expect(nameField().getAttribute("dir")).toBe("auto");
    expect(createButton().disabled).toBe(true);
    fireEvent.change(nameField(), { target: { value: "   " } });
    expect(createButton().disabled).toBe(true);
  });

  it("creates the trimmed name in the listed folder, then closes and refocuses the button", async () => {
    const { onCreate } = setup();
    fireEvent.change(nameField(), { target: { value: "  notes.txt " } });
    fireEvent.submit(screen.getByRole("dialog"));
    expect(onCreate).toHaveBeenCalledExactlyOnceWith(DOCS, "notes.txt");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(newFileButton());
  });

  it.each([
    ["fileExists", "newFile.fileExists"],
    ["invalidName", "newFile.invalidName"],
    ["accessDenied", "newFile.accessDenied"],
    ["somethingNew", "newFile.failed"],
  ] as const)("words a %s refusal under the field and stays open to fix the name", async (code, key) => {
    setup({ created: false, code });
    fireEvent.change(nameField(), { target: { value: "notes.txt" } });
    fireEvent.click(createButton());
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(t(key));
    expect(nameField().getAttribute("aria-invalid")).toBe("true");
    expect(nameField().getAttribute("aria-describedby")).toBe(alert.id);
    expect(nameField().value).toBe("notes.txt");
    // Typing a new name clears the error.
    fireEvent.change(nameField(), { target: { value: "notes2.txt" } });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("closes on Esc without leaving a search view, and on Cancel, without creating anything", () => {
    const { onCreate } = setup();
    const windowEsc = vi.fn((event: KeyboardEvent) => event.defaultPrevented);
    window.addEventListener("keydown", windowEsc);
    fireEvent.keyDown(nameField(), { key: "Escape" });
    window.removeEventListener("keydown", windowEsc);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(newFileButton());
    expect(windowEsc.mock.results.every((r) => r.value === true)).toBe(true);

    fireEvent.click(newFileButton());
    fireEvent.click(screen.getByRole("button", { name: t("newFile.cancel") }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("closes when another folder is listed, and stays open while one loads", () => {
    const { rerender } = setup();
    rerender(<NewFile folder={undefined} onCreate={vi.fn()} />);
    expect(screen.getByRole("dialog")).toBeTruthy();
    rerender(<NewFile folder={"D:\\Work"} onCreate={vi.fn()} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
