- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-set-up-the-project-and-connect-the-ui-to-the-engine.md`
  summary: When the engine process exits, the shell must clear its cached `ready`/stdin, tell the UI, and the client must end or time out pending requests (Story 1.2 territory).
  evidence: `engine.rs` `read_lines` just returns on EOF, leaving `last_ready` set, so a reload after a crash still shows "ready". `ProtocolClient.request()` has no timeout, so "Ping: pending" stays forever if the engine dies. Review findings B2/E1, B3a/E6.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-set-up-the-project-and-connect-the-ui-to-the-engine.md`
  summary: The shutdown kill fallback targets the `uv` launcher, not the Python engine, so the engine may be orphaned. Unverified, medium if true.
  evidence: In debug builds `Child` is `uv run ... python main.py`. Whether killing `uv` ends its Python child depends on uv using a kill-on-close Job Object. To settle it, kill the `uv` process in a test while the engine ignores EOF, then check for a surviving python.exe. Story 1.2's kill-the-whole-tree requirement should cover this. Review findings B7/E4/E19.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-2-recover-when-the-engine-stops.md`
  summary: Add a fault-injection seam around the `Job` wrapper and test the supervisor's `Stuck` path (a job that won't empty leads to `stopped` with no respawn), plus `Job::new` and `assign` failures.
  evidence: `run_generation` maps `!emptied` to `Outcome::Stuck`, but no test can make `terminate_and_wait` return false. Mapping `Stuck` to `Failed` would spawn a second engine on top of a live tree with every test green. Review findings B7/VG5.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-2-recover-when-the-engine-stops.md`
  summary: Add DOM component tests (jsdom + testing-library) for `EngineBanner`/App: `role="alert"` and the catalog text shown on restarting/stopped, hidden after ready.
  evidence: Only the non-React `EngineSession.snapshot` is tested. Inverting `if (!visible) return null` passes every suite. A natural fit for Story 1.3, when the real layout lands. Review findings B12/VG6.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-2-recover-when-the-engine-stops.md`
  summary: In Story 3.9 (packaged sidecar), close the spawn-before-job-assign race by starting the engine suspended or with `PROC_THREAD_ATTRIBUTE_JOB_LIST`.
  evidence: `engine.rs` accepts the race because `uv` takes milliseconds before its first child. A packaged engine that starts children at once could escape the job. Review finding B11.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-3-main-window-layout-and-visual-style.md`
  summary: Clamp the first-launch window size and position to the monitor's work area, because the default 1280×800 (and even the 960×600 minimum height) can exceed small screens, such as 1366×768 at 125% scaling.
  evidence: At 1366×768 and 125% the logical work area is about 1093×576, so the window opens partly off-screen. The 1.1 default of 1200×800 overflowed too. It belongs with UX-DR24's remembered window size and position (Story 4.1). Review finding E3.
