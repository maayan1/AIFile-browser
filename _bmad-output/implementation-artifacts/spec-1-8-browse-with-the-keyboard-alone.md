---
title: "Story 1.8: Browse with the keyboard alone"
type: 'feature'
created: '2026-11-10'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'e901de1c70db86e350e93dc7c9e6e1dcf50d639e'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Alt+D, Enter, Shift+F10/Menu key and Ctrl+Shift+E already work. Still missing: Alt+←/→/↑, ↑/↓ selection, and F5 (in WebView2, F5 reloads the whole page and loses history). The list also has no tab stop until a row is clicked, and focus is lost when a folder opens. So without a mouse you can't get into the list, and after opening a folder you can't keep going.

**Approach:** Add window-level shortcuts for Back, Forward, Up and reload. Give the list File Explorer's focus model (focus and selection are separate). Draw the row focus ring inside the row. Test the keys and the tab order.

## Boundaries & Constraints

**Always:**
- Shortcuts match File Explorer (EXPERIENCE.md "File Explorer muscle memory"). Window-wide, from any focus, including text fields: Alt+← back, Alt+→ forward, Alt+↑ up, and F5 (with or without Ctrl/Shift) or Ctrl+R / Ctrl+Shift+R reload the current folder. Each calls `preventDefault`, so WebView2 never navigates or reloads. Key repeats, `isComposing`, and events already `defaultPrevented` are ignored. Alt+← keeps its meaning under rtl.
- List focus model: the tab stop is the selected row, or else the first row in sort order. ↑/↓ on a focused row selects that row if it isn't selected; otherwise it moves the selection and focus to the neighbouring row, stopping at the ends (no wrap). Home/End select and focus the first/last row. Space selects the focused row. Clicking selects as today. Focusing a row doesn't select it.
- When a listing of a **different folder** arrives while focus is on `<body>` or inside the list body, focus moves to its first row, with nothing selected. A Show-in-folder `selected` row still wins (existing effect). Focus elsewhere (top bar, nav pane, path field) is never taken.
- A new listing of the **same folder** (F5, re-list after an engine restart) keeps the selection if that name is still listed, unless the listing names a `selected` item.
- Tab order is DOM order: top bar → filter bar → nav pane → main list (sort headers, then the row tab stop) → Preview Panel → status bar. No positive `tabIndex`. Areas with no enabled control (the disabled filter chips, the empty Preview Panel and status bar) are skipped, not made focusable.
- Every focusable element shows the 2px primary ring. Rows draw it inset (`outline-offset: -2px`), so the sticky header never hides it.
- `BrowseActions` gains `reload()` (`BrowseSession.reload` exists). Back/Forward/Up keep their existing no-op rules (no history, root).

**Never:** No Ctrl+E/Ctrl+F (Story 2.1), no Alt+P (Epic 4), no PageUp/PageDown, no roving focus in the nav pane, no multi-select. No Rust or engine changes. No new dependencies. No disabling of WebView2 accelerator keys in Rust.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Back/Up from the list | row focused, Alt+← or Alt+↑ | previous/parent folder lists; focus on its first row, none selected | no history / root: nothing happens |
| F5 | row `Photos` selected, F5 | `listFolder` of the current path, history unchanged; `Photos` still selected and focused; no page reload | engine down: list stays, banner shows |
| F5 in path field | editing path, F5 | folder re-lists; page not reloaded | N/A |
| First ↓ | Tab into list, nothing selected, ↓ | first row selected | N/A |
| Move | `Photos` selected, ↓ / ↑ at last row | next row selected and focused / stays | N/A |
| Open a folder by keyboard | Enter on folder row | new folder lists; focus on its first row | access denied: empty state, focus stays on body; Alt+← works |
| Focus elsewhere | nav pane button focused, folder opens | focus stays on the button | N/A |

</frozen-after-approval>

## Code Map

- `app/src/browse/session.ts` -- add `reload(): void` to `BrowseActions` (the class already has it, "stay" move).
- New `app/src/browse/shortcuts.ts` -- pure `shortcutFor(event): "back" | "forward" | "up" | "reload" | null` plus `useBrowseShortcuts(actions?)`: one `window` keydown listener (same shape as `Breadcrumb.tsx:60-69` Alt+D), modifier checks like `BrowseList.tsx:219`. Use `event.key` for the arrows/F5 and `event.code === "KeyR"` for Ctrl+R.
- `app/src/components/shell/AppShell.tsx` -- call `useBrowseShortcuts(actions)`.
- `app/src/browse/BrowseList.tsx` -- `selection` state and `selected` (lines 97-104): keep a same-path selection. `Row` gets `tabStop` and `onMove(key)`. Arrow/Home/End/Space handling goes in `Row.onKeyDown` (line 218); the movement lives in `BrowseList` over `rows` (sorted). New-folder focus is an effect on `listing` next to the Show-in-folder effect (line 108); track the last listed path in a ref. Update the 1.8 comments at lines 39 and 243.
- `app/src/index.css` -- `tr:focus-visible { outline-offset: -2px; }` beside the `:focus-visible` rule (line 159). Logical properties only (`style-rules.test.ts`).
- Tests: `BrowseList.test.tsx` (`fakeActions` gains `reload`; update "starts a new listing with nothing selected" to use a different path, and add a same-path case), plus the other `BrowseActions` fakes in `Breadcrumb.test.tsx`, `RowMenu.test.tsx` and `panes.test.tsx`. `App.test.tsx` has the shell stand-in, `reply`, `listingOf`, `lastRequest` and `flush` helpers.

## Tasks & Acceptance

**Execution:**
- [x] `app/src/browse/session.ts`, `app/src/browse/shortcuts.ts`, `app/src/components/shell/AppShell.tsx` -- `reload` on the interface; the shortcut map and hook; wire it.
- [x] `app/src/browse/BrowseList.tsx`, `app/src/index.css` -- the focus model, same-folder selection, new-folder focus, inset row ring.
- [x] `app/src/browse/shortcuts.test.ts` -- `shortcutFor` for every key and modifier combination, including the rejected ones (Alt+Shift+←, Ctrl+←, repeats, composing).
- [x] `app/src/browse/BrowseList.test.tsx` -- every list row of the matrix: tab stop with no selection, first ↓, ↑/↓/Home/End/Space, ends, new-folder focus, focus elsewhere untouched, same-path selection kept, `selected` override.
- [x] `app/src/App.test.tsx` -- a mouse-free journey: Enter opens a folder, ↓ selects, Alt+↑ goes up, Alt+← and Alt+→ move through history, F5 sends `listFolder` with the current path and its default is prevented, while the path field is open too.
- [x] `app/src/components/shell/AppShell.test.tsx` -- with a listing and actions, the enabled tabbable elements in DOM order fall in area order, the list has exactly one row tab stop, and no element has a positive `tabIndex`.

**Acceptance Criteria:**
- Given `tauri dev`, when I use only the keyboard, then every shortcut in the matrix works, F5 never reloads the page (Back history survives), and Tab shows a visible ring on every stop, including the first row under the sticky header.
- Given `npm test`, `npm run typecheck`, `uv run pytest` and `cargo test`, when run, then all pass.

## Implementation Notes

- `shortcutFor` returns null for repeats and IME compositions, as specified, but the window listener still calls `preventDefault` on such a shortcut key without running it: otherwise a held F5's repeats would reach WebView2 and reload the page. It also prevents F5 before `actions` exists. The keyboard's own BrowserBack/BrowserForward/BrowserRefresh keys (no modifiers) map to back/forward/reload.
- `reload()` re-sends a still-loading navigation instead of re-listing the committed location, so F5 right after Enter/Alt+←/Alt+↑ never undoes it.
- Same-folder selection carry-over is adjusted during render (previous listing kept in state), so the row never renders unselected for a frame. The last listed path resets to null on an error, so Back from an access-denied folder to the folder listed before it counts as a new folder and focuses its first row.

## Spec Change Log

## Review Triage Log

- 2026-11-10, review 1 (blind-hunter, edge-case-hunter, verification-gap):
- `medium` patched — F5 while a folder is still opening re-lists the old location. `reload()` reads the committed `location`, and `++latest` drops the pending reply, so the folder the user opened is lost (and an open path field closes on the wrong listing). Now `reload()` re-sends the newest pending request. (blind-hunter, edge-case-hunter)
- `medium` patched — focus is lost on a same-folder re-list. If F5 or a restart re-list drops the focused row, or a new listing unmounts the open row menu, focus falls to `<body>`, and the `listing.path === previous` early return never brings it back. Now any listing that finds focus on `<body>` focuses the list's tab stop. A Show-in-folder `selected` that isn't listed falls through to the same rule instead of returning early. (blind-hunter, edge-case-hunter ×3)
- `low` patched — an IME-composing F5/Ctrl+R/Alt+← returned before `preventDefault`, so WebView2 could reload the page. Now the default is prevented first, and only running the shortcut is skipped. (edge-case-hunter ×2)
- `low` patched — the BrowserRefresh media key reloads the page, and BrowserBack/BrowserForward weren't mapped. They now map to reload, back and forward. The mouse X-button part is `false`: the page has no history entries, so WebView2's history back does nothing. (edge-case-hunter, blind-hunter)
- `low` patched — RowMenu took every ArrowUp/ArrowDown, so Alt+↑ with the menu open was `defaultPrevented` and Up was skipped. The menu now handles only unmodified arrows. (edge-case-hunter)
- `low` patched — no test kept a Show-in-folder selection over a same-path re-list with no click in between. One is added. (verification-gap)
- `low` patched — `Breadcrumb.tsx` says Alt+D is "the only shortcut this story adds", which is now misleading. The comment is updated. (blind-hunter)
- `low` deferred — pressing Alt+← twice before the first reply goes back one step, because `back()` reads the committed stack. This predates the story (Story 1.5 buttons behave the same). (edge-case-hunter)
- `medium` deferred — rows carry `aria-selected` inside a plain `<table>`, so Narrator may not announce the arrow-key selection. The semantics predate the story (1.4); this belongs with Story 7.3's Narrator floor. (blind-hunter)
- `low` rejected — an empty folder opened from a row leaves focus on `<body>`. There is nothing in it to act on, and every window shortcut works from `<body>`. (edge-case-hunter)
- `low` rejected — Backspace as Back, and Shift/Ctrl+↑↓/Home/End scrolling the main area. Neither is in UX-DR21's map, the scroll is harmless, and each fix adds branches and guards. (blind-hunter)
- `low` rejected — Alt+D lacks the repeat/composition guards. A held Alt+D only re-selects the path text, which is harmless. (blind-hunter)
- `low` rejected — stale `menu` state after a new listing. It is never rendered again (`menu.listing === listing` can't match a new listing object), and the next menu replaces it. (blind-hunter)
- `low` rejected — the listener evaluates the event twice, and `MOVE_KEYS` uses a cast. The cost is negligible, and `satisfies` keeps the list and the union in sync. (blind-hunter)
- `false` — the matrix's "no history / root" and "engine down" rows have no App-level test. `session.test.ts` "does nothing for Back, Forward or Up when there's nowhere to go" and "lists the current folder again after a restart" cover them, and the hook test covers Ctrl+R through the real listener. (blind-hunter)
- `low` rejected — there's no automated check of the inset ring, and the tab-order test hard-codes today's areas. jsdom can't draw outlines (the manual check covers it), and the test is meant to change when the filter chips are enabled. (blind-hunter)
- `false` — tracking files: sprint status moves to `review` at presentation. `app/package.json` and the untracked spec stay out of this diff by the user's decision. (blind-hunter)
- After the patches: `npm test` 233 passed, `npm run typecheck` clean, `uv run pytest` 220 passed, `cargo test` 28 passed. Not yet checked under `tauri dev`.

## Verification

**Commands:**
- `cd app && npm test && npm run typecheck` -- expected: all pass
- `cd engine && uv run pytest` -- expected: all pass (unchanged)
- `cd app/src-tauri && cargo test` (from PowerShell) -- expected: all pass (unchanged)

**Manual checks:**
- Under `tauri dev`, with no mouse: Tab from the window start through every area. Enter a folder, ↓, Alt+↑, Alt+←, Alt+→, F5 (history kept), Shift+F10, Ctrl+Shift+E, Alt+D then F5.
