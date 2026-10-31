---
name: File Browser 2.0
description: Offline Windows 11 file browser that finds documents by what the user remembers. shadcn/ui on React + TypeScript + Tailwind inside Tauri; this DESIGN.md specifies the brand-layer delta only.
title: "DESIGN: File Browser 2.0"
status: final
created: 2026-10-30
updated: 2026-10-30
sources:
  - ../../prds/prd-AIFile-browser-2026-10-26/prd.md
colors:
  # Brand overrides on top of shadcn defaults. All unlisted tokens inherit
  # from shadcn (foreground, muted, muted-foreground, popover, card, border,
  # input, destructive). ring = primary.
  background: '#FFFFFF'
  background-dark: '#1C1C1C'
  surface-pane: '#F3F3F3'
  surface-pane-dark: '#202020'
  primary: '#0F6CBD'
  primary-foreground: '#FFFFFF'
  primary-dark: '#479EF5'
  primary-foreground-dark: '#0A1A2A'
  selection: '#CFE4FA'
  selection-dark: '#0F3A5F'
  notice-info: '#EBF3FC'
  notice-info-foreground: '#0F548C'
  notice-info-dark: '#082338'
  notice-info-foreground-dark: '#9CCBF8'
  close-match: '#FFF4CE'
  close-match-foreground: '#7A4D00'
  close-match-dark: '#3D2E00'
  close-match-foreground-dark: '#FFD86B'
typography:
  # Segoe UI Variable is the Windows 11 system font and covers Hebrew.
  body:
    fontFamily: "'Segoe UI Variable Text', 'Segoe UI', sans-serif"
    fontSize: 15px
    fontWeight: '400'
    lineHeight: '1.45'
  body-sm:
    fontFamily: "'Segoe UI Variable Text', 'Segoe UI', sans-serif"
    fontSize: 13px
    fontWeight: '400'
    lineHeight: '1.4'
  search-input:
    fontFamily: "'Segoe UI Variable Text', 'Segoe UI', sans-serif"
    fontSize: 18px
    fontWeight: '400'
    lineHeight: '1.3'
  excerpt:
    fontFamily: "'Segoe UI Variable Text', 'Segoe UI', sans-serif"
    fontSize: 14px
    fontWeight: '400'
    lineHeight: '1.5'
  group-label:
    fontFamily: "'Segoe UI Variable Text', 'Segoe UI', sans-serif"
    fontSize: 13px
    fontWeight: '600'
    lineHeight: '1.3'
    letterSpacing: 0.02em
  title:
    fontFamily: "'Segoe UI Variable Display', 'Segoe UI', sans-serif"
    fontSize: 20px
    fontWeight: '600'
    lineHeight: '1.25'
rounded:
  sm: 4px
  md: 6px
  lg: 8px
  full: 9999px
spacing:
  # Tailwind 4-based scale inherited. Named layout tokens below.
  nav-width: 240px
  preview-width: 320px
  row-height: 36px
  search-height: 44px
components:
  search-bar:
    background: '{colors.background}'
    border: '{colors.primary}'
    typography: '{typography.search-input}'
    height: '{spacing.search-height}'
    radius: '{rounded.md}'
  filter-chip:
    background: '{colors.surface-pane}'
    typography: '{typography.body-sm}'
    radius: '{rounded.full}'
  filter-chip-active:
    background: '{colors.selection}'
    foreground: '{colors.notice-info-foreground}'
    radius: '{rounded.full}'
  result-row-selected:
    background: '{colors.selection}'
    radius: '{rounded.sm}'
  close-match-label:
    background: '{colors.close-match}'
    foreground: '{colors.close-match-foreground}'
    typography: '{typography.body-sm}'
    radius: '{rounded.sm}'
  notice-banner:
    background: '{colors.notice-info}'
    foreground: '{colors.notice-info-foreground}'
    radius: '{rounded.md}'
  nav-pane:
    background: '{colors.surface-pane}'
    width: '{spacing.nav-width}'
  preview-panel:
    background: '{colors.surface-pane}'
    width: '{spacing.preview-width}'
  button-primary:
    background: '{colors.primary}'
    foreground: '{colors.primary-foreground}'
    radius: '{rounded.md}'
---

## Brand & Style

File Browser 2.0 should feel like a calmer, smarter File Explorer, not like a new tool to learn. Its users are everyday Windows 11 users, including older people like Yossi (67), who already know what a folder window looks like. The visual posture is **familiar, quiet and legible**: Windows 11 type and corners, one brand blue, generous text size, and almost no decoration. The search is the only new idea on screen, so the Search Bar is the only element that gets visual weight. `[ASSUMPTION: posture inferred from PRD target user and UJ-1; no brand material supplied]`

The app inherits shadcn/ui defaults. This file lists only the brand-layer deltas: colors tuned toward Windows 11, the Segoe UI Variable type ramp at a larger body size, Windows-like radii, and the product's own components.

## Colors

Light and dark tokens come in pairs (`-dark` suffix). The app follows the Windows light/dark setting. `[ASSUMPTION]`

- **Background (`#FFFFFF` / `#1C1C1C`)** is the main list area.
- **Surface pane (`#F3F3F3` / `#202020`)** is the nav pane, Preview Panel and status bar, so the main list reads as the "page" and the side areas as furniture.
- **Primary blue (`#0F6CBD` / `#479EF5`)** is close to the Windows 11 accent blue. It is used for the Search Bar border, primary buttons, focus rings, links and the indexing progress bar. Nothing else.
- **Selection (`#CFE4FA` / `#0F3A5F`)** marks the selected row and active Filter chips. Body text keeps its normal foreground on it.
- **Notice info (`#EBF3FC` on `#0F548C` text / `#082338` on `#9CCBF8`)** is used only for the "Indexing in progress: results may be incomplete" banner and other neutral notices.
- **Close match (`#FFF4CE` on `#7A4D00` text / `#3D2E00` on `#FFD86B`)** is used only for the Close Match label. Amber means "weaker match", never "error".
- **Errors** use shadcn's `destructive` token, and only for real failures (backend not responding). Access denied and empty results are not errors and never use red.

Contrast: every text/background pair above meets WCAG AA (4.5:1) for its text size. Primary blue on white is about 5:1.

## Typography

One family, Segoe UI Variable, which ships with Windows 11 and includes Hebrew glyphs, so English and Hebrew sit at the same size and weight.

| Role | Token | Used for |
|---|---|---|
| Body | `{typography.body}` (15px) | File names, list text, messages |
| Small | `{typography.body-sm}` (13px) | Location, dates, sizes, chips, labels |
| Search | `{typography.search-input}` (18px) | Search Bar text |
| Excerpt | `{typography.excerpt}` (14px) | Match Reason Passage, preview text |
| Group label | `{typography.group-label}` | "Name matches", "Content matches" |
| Title | `{typography.title}` (20px) | Preview Panel file name, first-run heading |

Body is 15px, one step above the Windows default of 14px, for older and non-technical readers. `[ASSUMPTION]` Sizes scale with the Windows text-size setting.

## Layout & Spacing

Tailwind's 4-based spacing scale is inherited. The main window follows File Explorer's layout, so users already know where things are:

```
┌──────────────────────────────────────────────────────────────────┐
│ ← → ↑  Documents › Volunteering           [ 🔍 Search Bar      ] │  top bar
│ [Date: Oct 1–31, 2025 ✕] [Type ▾]                                │  filter bar
├───────────┬──────────────────────────────────┬───────────────────┤
│ Nav pane  │ Main list                        │ Preview Panel     │
│ 240px     │ browse list, or Result List      │ 320px             │
│           │ ("Name matches" / "Content…")    │                   │
├───────────┴──────────────────────────────────┴───────────────────┤
│ Reading your documents: 340 of 2,100  ▓▓▓▓░░░░░░                  │  status bar
└──────────────────────────────────────────────────────────────────┘
```

Visual reference: [`mockups/key-search.html`](mockups/key-search.html) (English and mirrored Hebrew), [`mockups/key-states.html`](mockups/key-states.html), [`mockups/key-first-run.html`](mockups/key-first-run.html). This file wins on any conflict with a mockup.

- Rows are `{spacing.row-height}` (36px) high, a little taller than File Explorer, for easier clicking.
- The Search Bar is `{spacing.search-height}` (44px) high and takes the remaining width of the top bar, up to 640px.
- In the Hebrew interface the whole layout mirrors: nav pane on the right, Preview Panel on the left, Search Bar aligned to the left end of the top bar.
- Minimum window size is 960×600. Below 1280px wide, the Preview Panel collapses behind a toggle (see EXPERIENCE.md, Responsive & Platform). `[ASSUMPTION]`

## Elevation & Depth

Flat, like Windows 11 File Explorer. Panes are separated by tone (`{colors.surface-pane}` against `{colors.background}`) and a 1px `border`, not shadows. Only popovers (Date Filter, Type Filter, context menu) and dialogs use shadcn's shadow.

## Shapes

Windows 11 radii: `{rounded.sm}` (4px) for rows, inputs and labels, `{rounded.md}` (6px) for the Search Bar, buttons and banners, `{rounded.lg}` (8px) for dialogs and popovers. Filter chips are pills (`{rounded.full}`), so they read as removable tags.

## Components

shadcn components used as-is: `Button` (non-primary variants), `Dialog`, `Popover`, `DropdownMenu`, `ContextMenu`, `Checkbox`, `Calendar`, `Progress`, `Tooltip`, `Separator`, `ScrollArea`.

Brand-layer components:

- **Search Bar.** Magnifier icon at the start, `{typography.search-input}`, `{colors.primary}` 1px border (2px when focused), `{rounded.md}`. Placeholder: "Search by name, or describe what you remember". A clear (✕) button appears once there is text, and a small spinner replaces the magnifier while a search runs.
- **Filter chip.** Pill with label and ✕. Inactive: `{colors.surface-pane}`, label "Date" or "Type" with a ▾. Active: `{colors.selection}` with the value ("Oct 1–31, 2025", "PDF, Word") and a ✕ that clears it.
- **File list row** (browse view). Icon, name, type, size, modified date in columns. Selected: `{colors.selection}`.
- **Result group header.** `{typography.group-label}` in `muted-foreground`, with a count: "Name matches (3)", "Content matches (12)".
- **Content result row.** Two or three lines: (1) icon and file name in `{typography.body}`, with a Close Match label when applicable; (2) location and Activity Date in `{typography.body-sm}` `muted-foreground`; (3) the Match Reason excerpt in `{typography.excerpt}`, up to two lines, followed by satisfied-Filter tags ("Modified Oct 2025", "PDF") in `{typography.body-sm}`. No word highlighting (PRD FR-16).
- **Close Match label.** Small tag "Close match", `{colors.close-match}` on `{colors.close-match-foreground}`, `{rounded.sm}`.
- **Notice banner.** Full-width strip above the Result List, `{colors.notice-info}`, info icon, one sentence.
- **Preview Panel.** `{colors.surface-pane}`, `{spacing.preview-width}` wide. File icon and name in `{typography.title}`, then a details block (location, type, size, modified date) in `{typography.body-sm}`, then the text preview in `{typography.excerpt}` inside a `ScrollArea`. The empty state centers "Select a file to preview" in `muted-foreground`.
- **Status bar.** 28px high, `{colors.surface-pane}`. Shows the indexing progress text and a thin `Progress` bar in `{colors.primary}`. When idle: "Index up to date · 2,100 documents".
- **Empty state.** Centered in the main list: an outline icon, one `{typography.body}` sentence and up to two buttons (secondary variant).
- **Folder chooser** (first run). A `Dialog` with a checkbox list of folders (Documents and Desktop pre-checked), an "Add folder…" button, and one primary button.

## Do's and Don'ts

| Do | Don't |
|---|---|
| Look like Windows 11: Segoe UI Variable, flat panes, 4/6/8 radii | Introduce a custom visual language the user has to learn |
| Give the Search Bar the only visual weight on screen | Add hero graphics, gradients, AI sparkles or mascots |
| Use amber only for Close Match | Use amber or red for empty results or access-denied |
| Keep body text at 15px and respect Windows text scaling | Shrink text to fit more rows |
| Mirror the whole layout in Hebrew | Mirror file names, paths or extensions themselves (see EXPERIENCE.md, Bidirectional Text) |
| Use primary blue only for focus, action and progress | Use blue for decoration or plain labels |
