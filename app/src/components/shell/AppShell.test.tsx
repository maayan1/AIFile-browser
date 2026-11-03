// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { catalog, t } from "@/i18n/catalog";
import { AppShell } from "./AppShell";

// Vitest runs without globals, so testing-library can't clean up on its own.
afterEach(cleanup);

describe("AppShell", () => {
  it("has every area as a labeled landmark, in tab order", () => {
    render(<AppShell bannerVisible={false} />);
    const areas = [
      screen.getByRole("banner", { name: t("topBar.label") }),
      screen.getByRole("group", { name: t("filter.label") }),
      screen.getByRole("navigation", { name: t("nav.label") }),
      screen.getByRole("main", { name: t("main.label") }),
      screen.getByRole("complementary", { name: t("preview.label") }),
      screen.getByRole("contentinfo", { name: t("status.label") }),
    ];
    for (let i = 1; i < areas.length; i++) {
      expect(areas[i - 1].compareDocumentPosition(areas[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it("draws the later-story controls as inert placeholders", () => {
    render(<AppShell bannerVisible={false} />);
    for (const key of ["topBar.back", "topBar.forward", "topBar.up", "topBar.settings"] as const) {
      const button = screen.getByRole<HTMLButtonElement>("button", { name: t(key) });
      expect(button.disabled).toBe(true);
      expect(button.title).toBe(t(key));
    }
    for (const key of ["filter.date", "filter.type"] as const) {
      expect(screen.getByRole<HTMLButtonElement>("button", { name: t(key) }).disabled).toBe(true);
    }
    const search = screen.getByRole("textbox", { name: t("search.label") });
    expect(search.getAttribute("placeholder")).toBe(t("search.placeholder"));
    expect(search.getAttribute("dir")).toBe("auto");
    expect(screen.getByText(t("preview.empty"))).toBeTruthy();
  });

  it("shows the engine banner as an alert only while it is visible", () => {
    const { rerender } = render(<AppShell bannerVisible={true} />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe(t("engine.restarting"));
    // Under the filter bar, above the panes.
    const filters = screen.getByRole("group", { name: t("filter.label") });
    const nav = screen.getByRole("navigation", { name: t("nav.label") });
    expect(filters.compareDocumentPosition(alert) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(alert.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    rerender(<AppShell bannerVisible={false} />);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("mirrors only the directional icons under rtl", () => {
    render(<AppShell bannerVisible={false} />);
    const mirrored = (key: "topBar.back" | "topBar.forward" | "topBar.up" | "topBar.settings") =>
      screen.getByRole("button", { name: t(key) }).querySelector("svg")!.getAttribute("class")!.split(" ").includes("rtl:-scale-x-100");
    expect(mirrored("topBar.back")).toBe(true);
    expect(mirrored("topBar.forward")).toBe(true);
    expect(mirrored("topBar.up")).toBe(false);
    expect(mirrored("topBar.settings")).toBe(false);
  });

  it("shows only catalog text", () => {
    const { container } = render(<AppShell bannerVisible={true} />);
    const values = new Set<string>(Object.values(catalog));
    const shown: string[] = [];

    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent?.trim();
      if (text) shown.push(text);
    }
    const attrs = ["aria-label", "placeholder", "title", "alt", "aria-description", "aria-roledescription", "aria-valuetext", "value"];
    for (const el of container.querySelectorAll(attrs.map((a) => `[${a}]`).join(", "))) {
      for (const attr of attrs) {
        const value = el.getAttribute(attr);
        if (value) shown.push(value);
      }
    }

    expect(shown.length).toBeGreaterThan(0);
    for (const text of shown) expect(values, `"${text}" is not from the catalog`).toContain(text);
  });
});
