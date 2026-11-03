---
title: 'Story 1.3: Main window layout and visual style'
type: 'feature'
created: '2026-11-03'
status: 'done'
baseline_commit: 'c01c911533c240376b2c866c75dc68cb820f567f'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-AIFile-browser-2026-10-30/DESIGN.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The window is still the 1.1 developer status screen. Stories 1.4–1.8 need a real Windows 11 shell, theme and string catalog to render into.

**Approach:** Theme shadcn/ui with the DESIGN.md tokens (light/dark from the Windows setting), then build the File Explorer-style window frame: top bar, filter bar, nav pane, main list, Preview Panel and status bar. Areas whose behavior arrives in later stories stay empty or inert, and every string comes from the catalog.

## Boundaries & Constraints

**Always:**
- Use the DESIGN.md tokens exactly: the color pairs, the Segoe UI Variable ramp, radii 4/6/8, pill chips, 36px rows, the 44px Search Bar, a 240px nav pane, a 320px Preview Panel and a 28px status bar. Panes are flat, split by tone and a 1px border.
- Light/dark follows `prefers-color-scheme` (the Windows app mode), with no JS toggle.
- Focus is a 2px primary ring on `:focus-visible` everywhere.
- Use only logical CSS properties and Tailwind `rtl:`/`ltr:` variants. Directional icons (back, forward) mirror under `rtl`. `dir="rtl"` on `<html>` mirrors the window with no other change.
- Every user-visible string comes from `app/src/i18n/catalog.ts`, keyed `context.code`, in plain voice (no "index", "backend" or codes).
- The minimum window size is 960×600.
- The engine banner keeps its text and `role="alert"`, restyled with `destructive` (a real failure).

**Never:**
- No browse list, breadcrumbs, nav entries, navigation, search, filters, preview content or status text (Stories 1.4–1.8, Epics 2–6). No keyboard shortcuts (1.8).
- No responsive Preview collapse or remembered window size (Story 4.1 owns UX-DR24).
- No Hebrew strings, no forced-colors work, no 200% text-scaling audit (Epic 7).
- No product rules in the UI, no network fonts or assets, no new Tauri capabilities.

**Decisions (2026-11-03):**
- Dev readout: remove the 1.1/1.2 status readout from the window. Dev builds (`import.meta.env.DEV`) log the engine state, protocol version, Hebrew ping result and status phase to the console instead.
- Later-story areas are drawn as inert real controls. Back, Forward, Up and the gear are disabled buttons. The Date and Type chips are disabled pills. The Search Bar is a styled input with its placeholder that does nothing on Enter. The Preview Panel shows "Select a file to preview".
- Spec size: keep the full spec (about 2,300 tokens) as one goal.
- Search Bar focus (spec review R10): on focus the Search Bar's 1px primary border becomes 2px, and that is its 2px ring, with no extra outline. Every other control uses the global outline ring.

</frozen-after-approval>

## Code Map

- `app/src/App.tsx` -- It creates `ProtocolClient` + `EngineSession` and holds the dev status and Hebrew ping. Keep the session wiring and replace the markup with `<AppShell>`.
- `app/src/components/EngineBanner.tsx` -- Keep the props, text and `role="alert"`; restyle only.
- `app/src/i18n/catalog.ts` -- `catalog` + `t(key)`. Extend it; keep `engine.restarting` unchanged.
- `app/src/index.css` -- Only `@import "tailwindcss"` today. The theme goes here.
- `app/src/engine/session.ts`, `app/src/protocol/client.ts` -- Do not change.
- `app/index.html` -- `<html lang="en" dir="ltr">` is already there.
- `app/src-tauri/tauri.conf.json` `app.windows[0]` -- 1200×800, no minimum yet.
- `app/vite.config.ts` -- vitest `environment: "node"`. Keep it as the default; DOM tests opt in per file with `// @vitest-environment jsdom`.
- Deferred item D2 (from 1.2: no DOM test for `EngineBanner`) is closed by this story's render tests.
- TypeScript is 7.0.2, the native port. `baseUrl` is gone, so the `@/` alias uses `paths` alone (`"@/*": ["./src/*"]`). There is no JS compiler API, so no test may parse TSX with `typescript`.
- Vitest runs without `globals`, so testing-library doesn't auto-cleanup. DOM tests call `cleanup()` in `afterEach`.
- New pinned deps (each version at least two weeks old, peer-compatible with React 19): `class-variance-authority` 0.7.1, `clsx` 2.1.1, `tailwind-merge` 3.7.0, `lucide-react` 1.58.0. Dev: `jsdom` 30.1.2, `@testing-library/react` 16.3.3, `@testing-library/dom` 10.4.2.

## Tasks & Acceptance

**Execution:**
- [x] `app/package.json` -- add the pinned deps above (exact versions, npm).
- [x] `app/components.json`, `app/src/lib/utils.ts` -- shadcn config (new-york, CSS variables, `@/` alias) and `cn()`. Add the `@/` alias to `vite.config.ts` and `tsconfig.json`.
- [x] `app/src/components/ui/button.tsx` -- shadcn Button (cva variants `default`/`secondary`/`ghost`/`destructive`, sizes incl. `icon`), with no `asChild`, so it needs no Radix yet.
- [x] `app/src/index.css` -- the shadcn token contract (`--background`, `--foreground`, `--primary(-foreground)`, `--muted(-foreground)`, `--border`, `--input`, `--ring`, `--destructive`, `--popover`, `--card`, `--accent`) plus `--surface-pane`, `--selection`, `--notice-info(-foreground)` and `--close-match(-foreground)`. Set them on `:root` and override them in `@media (prefers-color-scheme: dark)`. Tokens DESIGN.md doesn't list take shadcn v4's **neutral** base-color defaults, light and dark. Map everything through `@theme inline`, together with the DESIGN.md font ramp (body 15px, body-sm 13px, search-input 18px, excerpt 14px, group-label, title 20px), the radii and the layout sizes. Font sizes and row/bar heights are in rem, so a root-size change scales them; widths stay px. Also set `color-scheme: light dark`, the body font, background and colors, `html, body, #root` at full height with no page scroll (panes scroll on their own), and the global `:focus-visible` ring.
- [x] `app/src/components/shell/` -- `AppShell` with `TopBar`, `FilterBar`, `NavPane`, `MainArea`, `PreviewPanel` and `StatusBar`, laid out per the Design Notes. Use landmarks: `header`, `nav`, `main`, `aside` and `footer`, each with an `aria-label` from the catalog. DOM order is the tab order: top bar → filter bar → nav → main → preview → status. Later-story controls are inert, as set in Decisions. Filter chips are a small `FilterChip` (pill, `surface-pane`, body-sm, label + chevron). `EngineBanner` restyle: `destructive` 1px border and text on `background`, radius 6, full width.
- [x] `app/src/App.tsx` -- render `<AppShell bannerVisible={…}>`, drop the dev markup, and log the dev readout to the console in DEV only.
- [x] `app/src/i18n/catalog.ts` -- add exactly: `topBar.label` "Navigation and search", `topBar.back` "Back", `topBar.forward` "Forward", `topBar.up` "Up", `topBar.settings` "Search folders", `breadcrumb.label` "Location", `search.label` "Search", `search.placeholder` "Search by name, or describe what you remember", `filter.label` "Filters", `filter.date` "Date", `filter.type` "Type", `nav.label` "Folders", `main.label` "Files", `preview.label` "Preview", `preview.empty` "Select a file to preview", `status.label` "Status".
- [x] `app/src-tauri/tauri.conf.json` -- set `minWidth` 960, `minHeight` 600 and a default size of 1280×800.
- [x] Tests (vitest):
  - `app/src/components/shell/AppShell.test.tsx` (jsdom):
    - Every landmark is present with its catalog label, in tab order.
    - The banner shows with `role="alert"` and the catalog text when visible, and is absent when hidden.
    - With the banner visible, every non-empty text node and every `aria-label`/`placeholder`/`title` value in the rendered shell equals a catalog value, which proves there is no hard-coded text.
  - `app/src/style-rules.test.ts` (node, `import.meta.glob` with `?raw`):
    - No physical-direction Tailwind class in `src/**/*.tsx`. Match whole class tokens: `(^|[\s"'\`:])-?(m[lr]|p[lr]|scroll-[mp][lr]|left|right|border-[lr]|rounded-[lr]|rounded-[tb][lr])-` and `text-(left|right)\b`, so `rounded-lg` doesn't match.
    - No `left`/`right` physical properties (`margin-left`, `padding-right`, `left:` etc.) in `src/**/*.css`.
    - The allowed forms are `ms-`/`me-`/`ps-`/`pe-`/`start-`/`end-`/`text-start`/`border-s`/`rounded-s`.
  - The existing catalog plain-text test still passes.

**Acceptance Criteria:**
- Given `tauri dev` on Windows in light mode, then dark mode, when the window opens, then all six areas show with the DESIGN.md colors for that mode, at the specified sizes, and the window can't shrink below 960×600.
- Given DevTools sets `dir="rtl"` on `<html>`, when the window renders, then the nav pane is on the right, the Preview Panel on the left, the Search Bar sits at the left end of the top bar and the back/forward arrows are mirrored, with no other change.
- Given keyboard Tab, when focus lands on any focusable control, then a 2px primary ring is visible.
- Given the engine is killed, when the banner shows, then it spans the window under the filter bar in the `destructive` style, and the shell stays usable.

## Design Notes

```
grid rows: auto (TopBar) | auto (FilterBar) | auto (banner) | 1fr (panes) | 28px (StatusBar)
TopBar: [◀][▶][▲] [breadcrumb field, flex-1, radius 4] [Search Bar ≤640px, h-44, radius 6, 1px primary, 2px on focus] [⚙]
panes:  NavPane 240px surface-pane | border-inline | MainArea 1fr background | border-inline | PreviewPanel 320px surface-pane
```

The Search Bar is `flex: 1 1 auto; max-inline-size: 640px`. It has a magnifier at the start and 18px `search-input` text, and uses `dir="auto"` for typed text. The icon buttons get `aria-label` and `title` from the catalog.

## Verification

**Commands:**
- `cd app && npm test` -- all pass, including the new shell and style-rule tests.
- `cd app && npx tsc --noEmit` and `npm run build` -- clean. The built CSS has no `left:`/`right:`/`margin-left`/`padding-right`-style physical properties.
- `cd engine && uv run pytest -q`, and `cd app/src-tauri && cargo test` (from PowerShell) -- still pass.

**Manual checks:**
- `.\node_modules\.bin\tauri.cmd dev`: walk through the four acceptance criteria, switching Windows Settings → Personalization → Colors → app mode for light/dark.

## Implementation Notes

- Implemented inline by the orchestrator (no subagent).
- Files:
  - New: `app/components.json`, `app/src/lib/utils.ts`, `app/src/components/ui/button.tsx`, `app/src/components/shell/{AppShell,TopBar,FilterBar}.tsx`, and the tests `AppShell.test.tsx` and `src/style-rules.test.ts`.
  - Changed: `index.css`, `catalog.ts`, `EngineBanner.tsx`, `App.tsx`, `tsconfig.json`, `vite.config.ts`, `tauri.conf.json`, `package.json`/lock.
- Deviations:
  - The nav pane, main area, Preview Panel and status bar were first inlined in `AppShell`. Review P10 moved them to `shell/panes.tsx` as `NavPane`/`MainArea`/`PreviewPanel`/`StatusBar`.
  - Layout uses flex (column plus a panes row), not CSS grid. Same rows as the Design Notes.
  - Search Bar width: the breadcrumb is `flex: 1 1 0` (min 160px) and the Search Bar `flex: 2 1 0` capped by `max-inline-size: 640px`, so the Search Bar takes the remaining width up to 640 and the breadcrumb gets the rest.
  - Search Bar focus (Decision R10): the 1px primary border plus an inset 1px primary `ring` on `focus-within` makes 2px without a layout shift. The input uses `outline-hidden`.
  - The style-rule regex requires `left-`/`right-` to be followed by `-`, so prose such as "the left end" in a comment doesn't fail it. A self-test pins the good and bad samples.
  - `index.css` has `@source not "./**/*.test.{ts,tsx}"`. Tailwind's auto-detection was pulling the style test's sample classes (`ml-2`, `text-left`…) into the built CSS.
  - The dev Hebrew ping and engine readout run only under `import.meta.env.DEV` and log with `console.info` (review P2; `debug` is hidden in DevTools by default).
- Verification (2026-11-03):
  - `npm test`: 59 passed.
  - `tsc --noEmit`: clean.
  - `npm run build`: clean. The built CSS has no `*-left`/`*-right`, `left:`/`right:` or `text-align: left|right`. It includes the `[dir=rtl]` mirror rule, `max-inline-size:640px`, the dark `:root` override and the global `:focus-visible` 2px outline.
  - `uv run pytest -q`: 37 passed.
  - `cargo test`: 17 passed.
  - Mutation check: injecting `pl-3` and a hard-coded `<span>` into `FilterBar` failed the style-rule and catalog-text tests. Reverted.
- After review pass 1 (2026-11-03):
  - New: `src/App.test.tsx` and `shell/panes.tsx`.
  - `vite.config.ts` sets `test.css: true`. Without it, vitest blanked `index.css` and the CSS RTL check was vacuous. A non-empty assertion now guards that.
  - `npm test`: 67 passed. `tsc`: clean. `npm run build`: clean, and the built CSS still has no physical left/right. `pytest`: 37 passed. `cargo test`: 17 passed.
  - Mutation checks: the banner wiring (`state === "restarting"`) and a `margin-left` in `index.css` each fail a test. Reverted.
- Risks and gaps:
  - Not seen on screen yet: light/dark, `dir="rtl"`, the focus ring and the banner under `tauri dev` (the four ACs are manual).
  - The inherited shadcn `muted-foreground` (≈ #737373) on `surface-pane` #F3F3F3 is about 4.3:1, just under AA 4.5:1 for the 15px "Select a file to preview". DESIGN.md says that token inherits from shadcn. Flag for Story 7.3 (accessibility floor).
  - Whether WebView2 maps the Windows Text size setting to the root font size is unverified (Epic 7).

## Spec Change Log

## Review Triage Log

Spec review (2026-11-03, before approval). Inline adversarial pass against the codebase, the pinned toolchain and DESIGN.md.

| # | Finding | Verdict | Route |
|---|---------|---------|-------|
| R1 | A source regex for hard-coded JSX text is brittle (`=>`, generics), and TS 7 has no JS compiler API | high | patched: the check is now DOM-based in the jsdom test |
| R2 | The physical-class regex `rounded-l` matches `rounded-lg` | medium | patched: token-boundary regex plus an allow list |
| R3 | The values of tokens DESIGN.md doesn't list are unspecified | medium | patched: shadcn v4 neutral defaults |
| R4 | `baseUrl` is removed in TS 7 | medium | patched: Code Map note |
| R5 | No auto-cleanup without vitest globals | low | patched: `cleanup()` in `afterEach` |
| R6 | `shell.*` catalog keys were a placeholder | low | patched: exact keys and values |
| R7 | The 18px search-input type and no-page-scroll were missing | low | patched |
| R8 | "rem follows Windows text size" is unverified | low | patched: reworded; the check is left to Epic 7 |
| R9 | The banner's destructive style was undefined | low | patched: border and text on background |
| R10 | The frozen "2px ring everywhere" doubles up with the Search Bar's 2px focus border | intent | user decided: the border is the Search Bar's ring (recorded in Decisions) |

Code review pass 1 (2026-11-03). Layers: Blind Hunter (B), Edge Case Hunter (E), Verification Gap (VG). No intent_gap or bad_spec, so no loopback. The orchestrator applied the patches (it implemented inline, so there was no subagent to re-engage).

| # | Finding | Verdict | Evidence | Route |
|---|---------|---------|----------|-------|
| VG1 | App's `session.subscribe` → `AppShell bannerVisible` wiring is untested | gap | Pre-verified: no test renders `App`, and dropping the subscribe call or passing a constant kept every suite green. | patch P1: `App.test.tsx` mocks `tauriTransport` and drives restarting → running+ready → stopped. A mutation (`state === "restarting"`) now fails it. |
| B13 / E1 / VG-other | The ping `.then` logs without checking `active`; `.catch` checks it | low | `App.tsx`: under StrictMode's double mount, a torn-down session's reply still logged. Direct one-line fix. | patch P2 |
| B7 | `console.debug` is hidden at DevTools' default levels | low | Chromium shows Verbose (debug) only on opt-in, which defeats the dev-readout Decision. | patch P2: `console.info` |
| B1 | The Button `destructive` variant has white text on the dark-mode light red (about 2.9:1) | low | The variant is unused today, but shadcn's own `dark:bg-destructive/60` was dropped. Direct restore. | patch P3 |
| B3 / E2 | `disabled:pointer-events-none` suppresses the disabled icon buttons' `title` tooltips | low | All four top-bar buttons are disabled and icon-only, so a mouse user can't learn them. File Explorer shows tooltips on a disabled Back. | patch P3: drop it; hover colors use `enabled:hover:` |
| B4 / E5 / E6 / E7 / E8 | The style-rule guard misses `origin-*/bg-*/object-*` left/right, `bg-linear-to-[lr]`, arbitrary `[left:…]`/`[margin-left:…]`, `!`/`}`-led tokens, `.ts` sources, inline style objects, and CSS `transform-origin`/`*-left-radius`/`background-position` | medium | Verified each sample against the old regex: none matched. Later stories could slip physical styling past the RTL guard. | patch P4: extended patterns, `.ts` glob (minus tests and generated), and a self-test listing every sample |
| B5 | No test for the back/forward mirroring, button titles, the banner's position, or the theme's focus ring and dark override | gap | Verified: none of these was asserted. | patch P5: AppShell tests for mirroring, titles and banner order; `theme rules` raw-CSS assertions |
| P4-found | Vitest blanks `.css` modules by default, so the CSS physical-property test read `""` and passed vacuously | high | Found while adding P5: `import.meta.glob('?raw')` returned length 0 for `index.css`. The CSS half of the RTL guard never ran. | patch: `test.css: true`, plus a non-empty assertion; a `margin-left` mutation now fails it |
| B6 | The catalog-text test skips `alt`/`aria-description`/`aria-roledescription`/`aria-valuetext`/`value` | low | None is rendered today. Direct list extension. | patch P6 |
| B6b | A raw literal equal to a catalog value (for example `"Back"`) passes the catalog-text test | low | Inherent while the catalog is English-only. Epic 7's Hebrew switch makes the test discriminating. A fix needs a locale seam. | reject |
| B8 | The search input has no `spellCheck={false}`/`autoComplete="off"` | low | WebView2 would underline names and Hebrew text in the main input. Direct attributes. | patch P7 |
| B11 / E4 | The `* { border-color }` rule skips pseudo-elements | low | shadcn/preflight pattern. Direct selector-list fix. | patch P8 |
| B2 / E-claim3 | The banner isn't full width, and its spacing is lopsided (no bottom gap) | low | "Not full width" is false: it spans the window inside the same 12px gutter as the top and filter bars, and the spec's radius 6 implies an inset strip. The missing bottom gap is real. | patch P9: `my-2` |
| E-claim1 | Spec task names `NavPane`/`MainArea`/`PreviewPanel`/`StatusBar` components; the code inlined them | low | A direct deviation from a clear spec. Following it is a pure extraction. | patch P10: `shell/panes.tsx` |
| B9 | At narrow windows the Search Bar doesn't take its 640px before the breadcrumb grows | low | Design interpretation: the spec's notes give both fields growth with no priority. At 960px the result is about 517px search and 259px breadcrumb, both usable. A change needs a layout decision once breadcrumbs exist (1.5). | reject |
| B10 | Search focus uses `focus-within`, not `:focus-visible` | false | Chromium matches `:focus-visible` on text inputs for mouse focus too, so the behavior is identical. | reject |
| B12 | `FilterChip` is hand-rolled, not `Button`, and its `label` prop takes a key | low | No named harm today; Epic 6 rebuilds the chip as a Popover/DropdownMenu trigger. | reject |
| E-claim2 | Under RTL the gear, not the Search Bar, is leftmost | false | The governing rule is "mirrors with no other change". The LTR order (search, then gear) mirrored is exactly what renders, and DESIGN.md's LTR description also has the gear after search. | reject |
| E3 | The default 1280×800 (and the 960×600 minimum) overflows small work areas, for example 1366×768 at 125% | medium | Real for common laptops. 1.1's 1200×800 overflowed too. A fix needs a startup clamp to the monitor's work area, which belongs with UX-DR24's remembered window size and position (Story 4.1). | defer D1 |
