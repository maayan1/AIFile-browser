# Network check (NFR-1)

**Claim:** the app makes zero network connections. That covers the app process, its WebView2
processes and the engine.

**Status:** the capture script and the regression guards are in place. The 10-minute measured
run hasn't been done yet: the author runs it (elevated) and the results go into [Runs](#runs) below.

## Method

`app/scripts/network-check.ps1` uses the Windows Filtering Platform (WFP) audit. It adds no
tools or packages.

1. It checks it is elevated. If not, it stops at once and changes nothing.
2. It records the current "Filtering Platform Connection" audit setting and the Security-log
   maximum size, then turns that audit on (success and failure) and raises the log to 1 GB. If the
   `auditpol /backup` file can't be read at all (no subcategory rows parse), or our row has an
   unreadable value, the run stops: guessing would mean restoring the wrong value. A file that
   parses but has no row for this subcategory means it isn't configured, which counts as 0 (none). The values to put back go to a fixed restore file,
   `%LOCALAPPDATA%\FileBrowser2\network-check\restore.json`. It sits outside `target/`, so
   `cargo clean` doesn't delete it, and `-OutDir` doesn't move it.
3. **Self-test.** The script opens a loopback TCP connection itself and waits up to 10 s for the
   matching 5156 event from its own PID. If none arrives, the audit isn't recording, so the run
   stops (and restores) before the app starts. The result goes into the JSON as `auditSelfTest`.
4. It starts the debug build through Explorer, so the app runs with the user's normal
   (un-elevated) rights.
5. Once a second it reads the Windows process list to track the app's process tree, and reads
   the new Security events 5156 (connection allowed) and 5157 (connection blocked). Each event
   gives the process ID, image, remote address and port, protocol (TCP or UDP) and direction.
   Every 10 s it snapshots `Get-DnsClientCache` to name the remote addresses.
6. When the time is up, it closes the app and keeps capturing through the shutdown. It then
   writes `network-check-<timestamp>.json` (to `app/src-tauri/target/network-check/`, which git
   ignores) and prints a summary.
7. In `finally` it stops any tree process still running, but only a PID whose live process still
   has the recorded image and start time. It then re-reads the audit setting and records it as
   `auditAtEnd`, with a warning in the JSON and on the console if it isn't still "success and
   failure" (for example, Group Policy changed it mid-run). Last, it puts the audit setting and
   log size back and checks they match what was there before. All of this also runs on an error
   and on Ctrl+C, and partial results are still written. If the window is closed outright, the
   next run restores the settings from the restore file first.
8. **Components.** The JSON records whether `msedgewebview2.exe`, `uv.exe` and `python.exe` were
   ever in the tree. If any wasn't, `summary.complete` is `false` and the console shows a warning:
   that part of the app wasn't measured.

`-DryRun` checks the prerequisites and changes nothing. It works without elevation.

**What counts.** Connections count only when they come from the app's tree:

- the root, `file-browser-2.exe`, matched by PID, image and start time;
- the root's direct children that are `msedgewebview2.exe`, `uv.exe` or `python.exe`;
- every descendant of those, whatever its image: WebView2's helpers and anything the engine starts.

Other direct children of the root, such as the default app for an opened file, aren't part of the
tree. A tree process stays in the tree while the same process (PID, image and start time) is
running, even after its parent exits.

An event counts for a tree process only when it has that process's image, and only while that
process can have made it: the process was alive at the last poll, or the event is no more than
one poll (plus 1 s) after the process was last seen. A PID that Windows reuses later, even for a
program with the same name, isn't counted as the app. The results are split into these groups:

| Group | What | Counted |
|-------|------|---------|
| app | remote address from a tree process | yes: must be 0 |
| local | loopback (`127.0.0.0/8`, `::1`, unspecified) from a tree process | no, listed |
| windows | EdgeUpdate (`MicrosoftEdgeUpdate.exe` and what it starts, such as an updater-launched `msedgewebview2.exe --type=...`) | no, listed |
| other WebView2 | `msedgewebview2.exe` belonging to other apps (Teams, Widgets...) | no, total only |

The script also lists the other programs the app started without counting them. The JSON holds no user paths, machine name or command lines, so it is
safe to quote here. For each tree process it keeps only the image name and the Chromium role (for
example `utility:network.mojom.NetworkService`). In the error text and restore problems, the
user-profile folder is replaced by `%USERPROFILE%`.

**Limits.**
- Windows' DNS Client service makes DNS lookups for the app, so a lookup on its own isn't
  attributed to the app. The connection that follows is.
- The tree is polled once a second. A process that starts, connects and exits within one poll
  is never seen, so its connections are missed.
- Every connection waits up to three polls for the tree poll, whatever its image, so a tree
  descendant that connects just before it is first seen is still attributed. After that, it's dropped.
- Restoring a lower Security-log maximum takes effect only after the log is next cleared. Until
  then the log file can stay at the size it reached during the run. The script never clears the
  log.

## Build measured

`cd app; npx tauri build --debug --no-bundle`. This build embeds the frontend, so no dev server
runs. It starts the engine from source with `uv run --offline` (`app/src-tauri/src/engine.rs`,
`engine_command()`), so uv never contacts PyPI. Release builds have no engine until Story 3.9,
and a clean-VM re-check belongs to Story 3.9 and Epic 8.

## Configuration in place before the first run

- `additionalBrowserArgs` is unset in `app/src-tauri/tauri.conf.json`, so wry applies
  `--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection`. SmartScreen therefore makes
  no lookups.
- CSP: `connect-src ipc: http://ipc.localhost`, so the page can reach only Tauri IPC. Every other
  directive allows only local sources.
- The engine talks only over stdin/stdout. It has no listener.
- Guards:
  - `app/src/network-rules.test.ts` fails in either of these cases:
    - `additionalBrowserArgs` is set without all three disabled features, or turns one back on
      (`:param` and `<Trial` suffixes count as the same feature);
    - a CSP fetch directive allows a non-local source, or `connect-src` allows anything beyond IPC.
  - `engine/tests/test_no_network.py` fails if any engine module imports a network library. That
    covers `socket`, `ssl`, `http`, `urllib`, `requests`, `httpx`, `multiprocessing.connection`,
    `webbrowser` and similar, asyncio streams and servers (also through an alias such as
    `import asyncio as aio`), and event-loop network calls.
  - `app/src-tauri/src/engine.rs` has a unit test that the dev engine starts with
    `uv run --offline`.
- The script itself is tested by `app/scripts/network-check.Tests.ps1` (Pester 3.4, which ships
  with Windows PowerShell 5.1). It uses synthetic processes and 5156/5157 events and needs no
  elevation. It checks:
  - how connections are grouped (app, local, Windows, other WebView2) and the tree rules (late
    processes, reused PIDs, orphans, descendants);
  - the self-test, the components check and the audit-policy parsing;
  - the refusal to run un-elevated;
  - the restore and kill path: a failure in the middle of a run, a closed app, and a run that
    reaches its deadline.
  Run it with `powershell -NoProfile -Command "Invoke-Pester app/scripts/network-check.Tests.ps1 -EnableExit"`.

## How to run

```powershell
cd app; npx tauri build --debug --no-bundle; cd ..
powershell -ExecutionPolicy Bypass -File app\scripts\network-check.ps1 -DryRun
# then, in PowerShell opened with "Run as administrator":
powershell -ExecutionPolicy Bypass -File app\scripts\network-check.ps1 -Minutes 10
```

Session steps (10 minutes of real use):
1. Browse: Documents, Desktop, Downloads, a drive root, several subfolders, and a folder you
   can't open.
2. Navigate: Back, Forward, Up, the breadcrumbs, and a typed path (valid and invalid).
3. Open files of several types (text, PDF, image, Office) in their default apps.
4. Use Show in folder on a few files, from the context menu and with Ctrl+Shift+E.
5. Press F5 several times. Sort by every column.
6. Use the app with the keyboard only for a minute.
7. Leave it idle for the rest of the time, then let the script close it.

## Runs

| # | Date | Build | Windows | WebView2 | Minutes | App connections | Local | Windows (EdgeUpdate) | Result |
|---|------|-------|---------|----------|---------|-----------------|-------|----------------------|--------|
| 1 |  |  |  |  |  |  |  |  |  |

## Endpoints found

Pending the first run. Results will be listed by group (app / windows / local) with the process,
role, remote address and port, protocol, hosts (from the DNS cache) and count.

## Disabled, and how

Nothing so far. Any WebView2 endpoint the run finds is turned off through `additionalBrowserArgs`.
The value then re-includes `msWebOOUI,msPdfOOUI,msSmartScreenProtection` in `--disable-features`,
and the run is repeated until it's clean.

## Reported to the author

Nothing so far. This section lists any endpoint that can't be turned off by configuration.

## Final clean run

Pending.
