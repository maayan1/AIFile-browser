- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-set-up-the-project-and-connect-the-ui-to-the-engine.md`
  summary: When the engine process exits, the shell must clear its cached `ready`/stdin, tell the UI, and the client must end or time out pending requests (Story 1.2 territory).
  evidence: `engine.rs` `read_lines` just returns on EOF, leaving `last_ready` set, so a reload after a crash still shows "ready". `ProtocolClient.request()` has no timeout, so "Ping: pending" stays forever if the engine dies. Review findings B2/E1, B3a/E6.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-set-up-the-project-and-connect-the-ui-to-the-engine.md`
  summary: The shutdown kill fallback targets the `uv` launcher, not the Python engine, so the engine may be orphaned. Unverified, medium if true.
  evidence: In debug builds `Child` is `uv run ... python main.py`. Whether killing `uv` ends its Python child depends on uv using a kill-on-close Job Object. To settle it, kill the `uv` process in a test while the engine ignores EOF, then check for a surviving python.exe. Story 1.2's kill-the-whole-tree requirement should cover this. Review findings B7/E4/E19.
