import { describe, expect, it } from "vitest";

// FR-18 readiness: the layout uses only logical properties and `rtl:`/`ltr:` variants, so
// `dir="rtl"` on <html> mirrors the window with no other change. Allowed forms: ms-/me-/ps-/pe-,
// start-/end-, text-start/-end, border-s/-e, rounded-s/-e, origin-*-start style logical values.
const sources = import.meta.glob<string>(["./**/*.{ts,tsx}", "!./**/*.test.{ts,tsx}", "!./protocol/generated.ts"], {
  query: "?raw",
  import: "default",
  eager: true,
});
const css = import.meta.glob<string>("./**/*.css", { query: "?raw", import: "default", eager: true });

// Whole class tokens only (after a space, quote, backtick, variant colon, `!` or `}`),
// so `rounded-lg` or `px-3` never match.
const LEAD = String.raw`(?:^|[\s"'\x60:!}])`;
const PHYSICAL_CLASS = new RegExp(
  [
    LEAD + String.raw`-?(?:m[lr]|p[lr]|scroll-[mp][lr]|border-[lr]|rounded-[lr]|rounded-[tb][lr])(?=[-\s"'\x60]|$)`,
    LEAD + String.raw`-?(?:left|right)-`,
    LEAD + String.raw`(?:text|float|clear)-(?:left|right)\b`,
    LEAD + String.raw`(?:origin|bg|object)-(?:[a-z]+-)?(?:left|right)\b`,
    LEAD + String.raw`bg-(?:linear|gradient)-to-[lr]\b`,
    // Arbitrary properties: [margin-left:4px], [left:0]
    String.raw`\[(?:margin|padding|border|inset|scroll-margin|scroll-padding)-(?:left|right)\b`,
    String.raw`\[(?:left|right):`,
    // Inline style objects: { marginLeft }, { left: 0 }
    String.raw`\b(?:margin|padding|border)(?:Left|Right)\b`,
    String.raw`\bstyle=\{\{[^}]*\b(?:left|right)\s*:`,
  ].join("|"),
  "m",
);

const PHYSICAL_CSS = new RegExp(
  [
    String.raw`\b(?:margin|padding|border|inset|scroll-margin|scroll-padding)-(?:left|right)\b`,
    String.raw`\bborder-(?:top|bottom)-(?:left|right)-radius\b`,
    String.raw`(?:^|[\s;{])(?:left|right)\s*:`,
    String.raw`\b(?:text-align|float|clear)\s*:\s*(?:left|right)\b`,
    String.raw`\b(?:transform-origin|background-position|object-position|justify-content)\s*:[^;]*\b(?:left|right)\b`,
  ].join("|"),
  "m",
);

describe("style rules", () => {
  it("finds the source files", () => {
    expect(Object.keys(sources).some((f) => f.endsWith(".tsx"))).toBe(true);
    expect(Object.keys(sources).some((f) => f.endsWith(".ts"))).toBe(true);
    expect(Object.keys(css).length).toBeGreaterThan(0);
    // Vitest blanks CSS unless `test.css` is on; an empty read would make the CSS checks vacuous.
    for (const source of Object.values(css)) expect(source.length).toBeGreaterThan(0);
  });

  it.each(Object.entries(sources))("%s uses no physical-direction classes or styles", (_file, source) => {
    expect(source.match(PHYSICAL_CLASS)?.[0] ?? null).toBeNull();
  });

  it.each(Object.entries(css))("%s uses no physical-direction properties", (_file, source) => {
    expect(source.match(PHYSICAL_CSS)?.[0] ?? null).toBeNull();
  });

  it("catches physical classes and lets logical ones through", () => {
    const bad = [
      'className="ml-2"',
      "'pr-4'",
      "`border-l`",
      " rounded-r-md",
      ' text-left"',
      " -left-1",
      " !ml-2",
      "}pl-3",
      " origin-top-right",
      " bg-right",
      " object-left",
      " bg-linear-to-r",
      " [margin-left:4px]",
      " [left:0]",
      "style={{ marginLeft: 4 }}",
      "style={{ left: 0 }}",
    ];
    for (const sample of bad) expect(sample, sample).toMatch(PHYSICAL_CLASS);
    const good = [
      'className="ms-2 pe-4 px-3 rounded-lg border-s text-start"',
      " rounded-md",
      " the left end",
      " [max-inline-size:640px]",
      " rtl:-scale-x-100",
    ];
    for (const sample of good) expect(sample, sample).not.toMatch(PHYSICAL_CLASS);

    for (const sample of ["a { margin-left: 0 }", "a { left: 0 }", "a { transform-origin: top left }", "a { border-top-right-radius: 4px }"]) {
      expect(sample, sample).toMatch(PHYSICAL_CSS);
    }
    expect("a { margin-inline-start: 0 }").not.toMatch(PHYSICAL_CSS);
  });
});

describe("theme rules", () => {
  const theme = Object.entries(css).find(([file]) => file.endsWith("/index.css"))?.[1] ?? "";

  it("shows focus as a 2px primary ring", () => {
    expect(theme).toMatch(/:focus-visible\s*\{\s*outline:\s*2px solid var\(--color-ring\);/);
    expect(theme).toMatch(/--ring:\s*var\(--primary\);/);
  });

  it("follows the Windows light/dark setting with the DESIGN.md pairs", () => {
    expect(theme).toMatch(/:root\s*\{[^}]*--background:\s*#ffffff;[^}]*--primary:\s*#0f6cbd;/);
    expect(theme).toMatch(/@media \(prefers-color-scheme: dark\)\s*\{\s*:root\s*\{[^}]*--background:\s*#1c1c1c;[^}]*--primary:\s*#479ef5;/);
  });
});
