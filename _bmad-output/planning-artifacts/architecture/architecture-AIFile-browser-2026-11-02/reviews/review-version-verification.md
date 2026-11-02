# Review — Version and Reality Verification

Reviewer lens: was each committed decision web-checked rather than asserted from training data? Checked 2026-11-02 against official registries (PyPI, npm, crates.io, python.org), vendor docs (Tauri v2, Microsoft Learn, ONNX Runtime, NumPy, Tailwind) and the Hugging Face model repos.

**Verdict: Sound technology choices, but not ready to freeze as written. Two high findings: the onedir sidecar needs more than `externalBin`, and the WebView2 zero-network claim covers only SmartScreen. Three Stack versions are stale (ONNX Runtime, TypeScript, Python).**

Counts: critical 0 · high 2 · medium 7 · low 4

---

## Findings

### F-1 [high] AD-12: `externalBin` alone cannot ship a PyInstaller `--onedir` build

- **Checked:** Tauri v2 sidecar and resources docs; PyInstaller onedir layout; Tauri issue #15134.
- **Found:** `externalBin` registers **one executable** per entry. It must be named `<name>-<target-triple>.exe` (for example `engine-x86_64-pc-windows-msvc.exe`), with the path resolved relative to `src-tauri/`. A `--onedir` build is an exe plus an `_internal/` folder that holds the Python DLL, `.pyd` files, ONNX Runtime and NumPy. If only the exe is shipped, it fails at start with "failed to load Python DLL". The folder has to be shipped through `bundle.resources`, using map syntax such as `"../engine/dist/engine/_internal/": "_internal/"`. On Windows, `$RESOURCE` is the install directory, so the folder lands next to the sidecar exe. Two problems are also reported, though unconfirmed by maintainers: NSIS can skip replacing an unversioned sidecar exe on a same-version reinstall, and a stale sidecar can be bundled from the `target/release` cache.
- **Fix:** Reword AD-12 as follows. "The onedir exe is registered via `externalBin` with the triple suffix. Its `_internal/` folder is bundled via `bundle.resources` (map form) so that it sits beside the exe. The model file is also a resource, resolved at runtime from the resource dir." Add a build step that renames the exe and runs PyInstaller with `--clean`. Add an NSIS `installerHooks` step that stops a running sidecar before files are copied, which FR-21 updates need. As an alternative, evaluate PyInstaller's `--contents-directory .` to flatten the layout.
- **Sources:** https://v2.tauri.app/develop/sidecar/ · https://v2.tauri.app/develop/resources/ · https://github.com/tauri-apps/tauri/issues/15134 · https://github.com/recursivezero/vector-watcher/wiki/Backend-Packaging

### F-2 [high] AD-12 / AD-11 / NFR-1: WebView2 traffic is more than SmartScreen

- **Checked:** Tauri `WindowConfig.additional_browser_args` docs; Microsoft Q&A on WebView2 outbound calls; WebView2 SmartScreen API.
- **Found:** The premise "SmartScreen can be disabled inside the app" is **true**, and it is already the default. wry passes `--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection` unless `additionalBrowserArgs` is set. Setting that option **replaces** the default list, which silently turns SmartScreen back on. Microsoft's own thread also shows WebView2 calling `config.edge.skype.com`, the Edge experimentation/config service, in addition to the SmartScreen hosts. The Evergreen runtime also has its own updater. The spine treats SmartScreen as the only WebView2 network path, so NFR-1 ("zero connections, verified by firewall log") is at risk at the Phase 5 gate.
- **Fix:** (a) Add to AD-12: "Never set `additionalBrowserArgs` without re-including `msSmartScreenProtection` in `--disable-features`." (b) Add a Phase 1 story: run the bare Tauri shell under a firewall log or Procmon for 10 minutes with networking on, and record every remote endpoint the WebView2 child processes contact. Then decide on mitigations, such as more browser args, or a documented NFR-1 exclusion for the runtime updater as a Windows component. (c) State that the updater (`msedgewebview2` updates via EdgeUpdate) counts as Windows under NFR-1, or move to `fixedRuntime` (~180 MB, which then needs manual security updates).
- **Sources:** https://docs.rs/tauri-utils/latest/tauri_utils/config/struct.WindowConfig.html · https://learn.microsoft.com/en-us/answers/questions/306504/webview2-makes-external-api-calls-to-microsoft-dom · https://github.com/MicrosoftDocs/webview2-win32-reference/blob/live/1-0-1722-45/icorewebview2settings8.md · https://learn.microsoft.com/microsoft-edge/webview2/concepts/enterprise

### F-3 [medium] Stack: ONNX Runtime "1.27" is stale

- **Checked:** PyPI `onnxruntime`.
- **Found:** The latest is **1.31.1** (released 2026-10-26). It has `win_amd64` wheels for cp311–cp314, requires Python ≥ 3.11, and is MIT-licensed. The memlog says 1.27.1 came from "aggregators", so it was not checked against PyPI. 1.27 is four minor versions behind.
- **Fix:** Change to `1.31.x (pin exact patch at the first Phase 1 story)`. Alternatively, use the same "pin at Phase 1" wording as the other rows.
- **Source:** https://pypi.org/project/onnxruntime/

### F-4 [medium] Stack: TypeScript "5.x" is two majors behind

- **Checked:** npm `typescript`.
- **Found:** The latest is **7.0.2**. This is the Go-native compiler, released July 2026, and 6.0 was the bridge release. TS 7 matches 6.0's type-checking, but the old compiler plugin/programmatic API does not work in 7.0, and the stable API is promised for 7.1. Some tooling, such as typescript-eslint and anything that uses the TS API, may need the `@typescript/typescript6` compatibility package (`tsc6`).
- **Fix:** Replace with "TypeScript 7.x for `tsc --noEmit`, plus `@typescript/typescript6` where lint tooling needs the JS API; pin at Phase 1". Alternatively, pin 6.0 deliberately. Either way, drop 5.x.
- **Sources:** https://registry.npmjs.org/typescript/latest · https://infoq.com/news/2026/08/typescript-7-released/ · https://visualstudiomagazine.com/articles/2026/06/22/typescript-7-0-rc-moves-microsofts-go-rewrite-into-the-mainline-compiler.aspx

### F-5 [medium] Stack: Python 3.13 is now security-only; 3.14 is the right target

- **Checked:** python.org downloads, the ORT and PyInstaller classifiers, tokenizers wheels.
- **Found:** Since 3.15.0 shipped on 2026-10-09, **3.13 is in security-fix status** (3.13.18). **3.14 is bugfix** (3.14.10). 3.15 is too new: ORT 1.31.1 has no cp315 wheels. Every engine dependency checked supports 3.14: ORT 1.31.1 cp314, PyInstaller 6.22.3 (3.8–3.15), python-docx (≥ 3.9), tokenizers (abi3), and NumPy 2.5.
- **Fix:** Change the Stack row to `Python 3.14 (pin patch at Phase 1)` and drop the "confirm ORT wheel" caveat, since the wheels are confirmed.
- **Sources:** https://www.python.org/downloads/ · https://pypi.org/project/onnxruntime/ · https://pypi.org/project/pyinstaller/

### F-6 [medium] AD-2: "one UTF-8 JSON object per line" is not Python's default on Windows pipes

- **Checked:** PEP 686.
- **Found:** UTF-8 mode becomes the default only in **Python 3.15**. On 3.13 and 3.14, redirected `sys.stdin` and `sys.stdout` use the ANSI code page: cp1252, or cp1255 on Hebrew-locale Windows. Hebrew queries arriving from the shell as UTF-8 would be decoded wrongly. `print` also block-buffers when stdout is a pipe, which would delay progress events. In addition, any library that writes to stdout would corrupt the protocol stream.
- **Fix:** Add to AD-2: "The engine forces UTF-8 on stdin and stdout, either with `sys.stdin.reconfigure(encoding='utf-8')` or by enabling `-X utf8` in the PyInstaller spec. It flushes after every line. stdout carries protocol lines only, and all logging goes to file or stderr."
- **Source:** https://peps.python.org/pep-0686/

### F-7 [medium] AD-6: the Windows "atomic rename" premise has caveats

- **Checked:** Python `os.replace`, which is MoveFileExW with REPLACE_EXISTING; CPython and PostgreSQL discussions; NumPy `load`.
- **Found:** `os.replace` within one NTFS volume is the accepted best practice, but Microsoft does not document it as atomic. It **fails with WinError 5 or 32** while any other handle is open on `manifest.json` without FILE_SHARE_DELETE. That includes the engine's own reader threads (Python `open()` never passes FILE_SHARE_DELETE), Defender, and the Search indexer. The spine also does not require `fsync` before the rename, so after a power loss the new manifest could point at a meta/vec pair whose data never reached disk. Deleting older `vec-<v>.npy` files fails if anything memory-mapped them (`np.load(mmap_mode=...)`). `np.load` defaults to `allow_pickle=False`, which is good for loading untrusted local files.
- **Fix:** Add to AD-6: "Write temp, flush and `os.fsync`, then rename. The manifest replace retries on WinError 5/32 with short backoff. Readers never hold `manifest.json` open: the writer announces new versions in-process. `.npy` is loaded fully, without mmap, and always with `allow_pickle=False`. On start, delete orphaned temp files and any `meta`/`vec` versions not named by the manifest, tolerating locked-file failures."
- **Sources:** https://bugs.python.org/issue8828 · https://hackorum.dev/topics/37779 · https://numpy.org/doc/stable/reference/generated/numpy.load.html

### F-8 [medium] AD-8 / Stack: the runtime dependencies of the ONNX path, and per-model differences, are not stated

- **Checked:** Both model cards and their `onnx/` folders, and PyPI `tokenizers`.
- **Found:** Running a Hugging Face ONNX model without PyTorch needs the **`tokenizers`** library (0.23.3, Apache-2.0, abi3 Windows wheel) and **NumPy**. Neither is in the Stack. The easy paths (`sentence-transformers` with `backend="onnx"`, `transformers`, `optimum`) pull in PyTorch, which AD-8 forbids. The two candidates also differ in more than id and dimension:
  - **Pooling:** granite-r2 uses CLS pooling, e5-small uses masked mean.
  - **Prefixes:** granite-r2 uses none. e5-small requires `"query: "` and `"passage: "`, and its card warns that leaving them out degrades results.
  - **Maximum length:** granite-r2 accepts 32,768 tokens, e5-small 512 tokens (longer input is truncated).
  - **Quantized ONNX build:** granite-r2 publishes `model_quint8_avx2.onnx` at 98 MB (fp32 is 390 MB). e5-small's int8 file is `qint8_avx512_vnni` at 118 MB (fp32 is 470 MB). The VNNI-targeted file may lose accuracy or speed on AVX2-only Baseline PCs.
- **Fix:** Add `tokenizers` and `numpy` (both "pin at Phase 1") to the Stack, and add "no transformers, sentence-transformers or optimum in the shipped engine" to AD-8. Extend the AD-6 manifest fields with the pooling mode, the query and passage prefix strings, the max tokens, and a SHA-256 of the model file. Cap Passage size so that "passage: " plus text stays at or under 512 tokens if e5 wins. Include both fp32 and int8 variants in the bake-off, measured on an AVX2-only CPU.
- **Sources:** https://huggingface.co/ibm-granite/granite-embedding-97m-multilingual-r2 · https://huggingface.co/intfloat/multilingual-e5-small · https://huggingface.co/api/models/ibm-granite/granite-embedding-97m-multilingual-r2/tree/main/onnx · https://huggingface.co/api/models/intfloat/multilingual-e5-small/tree/main/onnx · https://pypi.org/project/tokenizers/

### F-9 [medium] AD-12: ONNX Runtime on Windows needs the Visual C++ runtime

- **Checked:** The ONNX Runtime install docs; reports of `onnxruntime_pybind11_state` DLL load failures.
- **Found:** The docs say "Windows builds require Visual C++ 2019 runtime." A clean Windows 11 PC, which is the Phase 5 gate, is not guaranteed to have `msvcp140.dll`. Whether PyInstaller collects it into `_internal/` depends on the build machine. Mismatched copies of `vcruntime140`/`msvcp140` have also caused `DLL load failed` errors.
- **Fix:** Add to AD-12: "The onedir build must contain the VC++ 14.x runtime DLLs app-locally. These are redistributable under the Visual Studio license. Verify this by running the sidecar on a clean Windows 11 VM in Phase 3, when the packaged backend is first built, not in Phase 5."
- **Sources:** https://onnxruntime.ai/docs/install/ · https://riverbankcomputing.com/pipermail/pyqt/2025-November/046379.html

### F-10 [low] AD-4: the OneDrive check is right, but incomplete for folders

- **Checked:** Microsoft "File Attribute Constants".
- **Found:** `FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS` (0x00400000) exists and marks content that is not fully present locally, so the premise holds. `FILE_ATTRIBUTE_RECALL_ON_OPEN` (0x00040000) also exists. It appears in directory enumeration and marks items, typically directories, that the provider fetches when they are opened. Browsing and the Filename Search walk could therefore make OneDrive fetch online-only folder listings.
- **Fix:** In AD-4, check both bits. Read them from `os.scandir()` entries (`DirEntry.stat().st_file_attributes`, which comes from the enumeration data without opening the file), and do not descend into a directory that has RECALL_ON_OPEN set.
- **Source:** https://learn.microsoft.com/windows/win32/fileio/file-attribute-constants

### F-11 [low] NFR-12 / AD-12: redistribution needs a notices file

- **Checked:** The licenses below.
- **Found:** Every candidate is redistributable:
  - ORT: MIT
  - granite-r2: Apache-2.0
  - e5-small: MIT
  - python-docx: MIT
  - tokenizers: Apache-2.0
  - PyInstaller: GPLv2+ with the bootloader exception, which explicitly allows distributing frozen non-free or any programs
  - pdfminer.six: MIT
  - pdf_oxide: MIT OR Apache-2.0

  Apache-2.0 and MIT both require the license text to travel with the binaries, and so do the bundled Python (PSF), NumPy (BSD, plus its bundled OpenBLAS and runtime notices) and lxml/libxml2. The spine says only "must have a redistributable license".
- **Fix:** Add to AD-12: "The installer ships a `THIRD_PARTY_NOTICES` file, generated at build time from the frozen environment and including the model licenses."
- **Sources:** https://pypi.org/project/pyinstaller/ · https://pypi.org/project/onnxruntime/ · https://pypi.org/project/python-docx/ · https://pypi.org/project/pdfminer.six/ · https://pypi.org/project/pdf-oxide/

### F-12 [low] Deferred, PDF spike: both candidates carry maintenance risk

- **Checked:** PyPI and GitHub release notes.
- **Found:** **pdfminer.six** 20260107 (Jan 2026) describes itself as community-maintained with "limited maintainer availability" and has no RTL/bidi support. **pdf_oxide** 0.3.78 (Sep 2026) is pre-1.0, has a single maintainer and changes fast. Its Hebrew visual-to-logical fixes landed in 0.3.12, 0.3.54 and 0.3.65. Its `reorder_visual_to_logical` assumes the caller already knows the text is in visual order, and the default converter does not apply it.
- **Fix:** In the Deferred bullet, require the spike to pin the exact version tested, to record whether bidi reordering is automatic or caller-driven, and to keep pypdf (BSD) as a third candidate in case both fail.
- **Sources:** https://pypi.org/project/pdfminer.six/ · https://pypi.org/project/pdf-oxide/ · https://github.com/yfedoseev/pdf_oxide/releases/tag/v0.3.54 · https://github.com/yfedoseev/pdf_oxide/releases/tag/v0.3.65

### F-13 [low] AD-12: Smart App Control and unsigned onedir binaries are not carried over from the PRD

- **Checked:** The PRD addendum's "Unsigned installer" note.
- **Found:** An onedir build has dozens of unsigned `.pyd` and `.dll` files. Smart App Control, when it is on, evaluates each one, not only the installer. The spine's deployment diagram mentions only the SmartScreen README step.
- **Fix:** Add one line to AD-12, or to the Phase 3 packaged-size check: "Run the packaged sidecar on a clean Windows 11 VM with Smart App Control in evaluation mode and Defender on; record any blocks."
- **Source:** PRD addendum.md, "Unsigned installer (FR-19)".

---

## Verified OK

- **Tauri 2:** Current, at crate 2.12.5 (2026-10-21) and CLI 2.12.4. Sidecar via `bundle.externalBin` with the `-<target-triple>` suffix and the shell plugin (`shell:allow-execute`/`allow-spawn` with `sidecar: true`) works as described, with stdin written via `child.write`. https://v2.tauri.app/develop/sidecar/ · https://crates.io/crates/tauri
- **Tauri NSIS and WebView2 `offlineInstaller`:** The mode exists and adds about 127 MB with no internet needed. NSIS installs per-user into `%LOCALAPPDATA%` by default, so no admin rights are needed. WebView2 already ships with Windows 11, so the offline installer is insurance rather than a requirement. https://v2.tauri.app/distribute/windows-installer/
- **SmartScreen in WebView2 is disabled by default in Tauri/wry** via `msSmartScreenProtection` (see F-2 for the override trap).
- **React 19.x:** Latest 19.3.1. https://registry.npmjs.org/react/latest
- **Tailwind CSS 4.3:** Latest 4.3.3. The `rtl:`/`ltr:` variants exist in v4. https://tailwindcss.com/docs/hover-focus-and-other-states
- **PyInstaller `--onedir` as a Tauri sidecar:** A documented use case. Latest is 6.22.3 (2026-09-12), supporting Python 3.8–3.15.
- **ONNX Runtime CPU with Python 3.13:** cp313 and cp314 `win_amd64` wheels exist for 1.31.1. MIT.
- **granite-embedding-97m-multilingual-r2:** Apache-2.0, 97.4M parameters, 384 dimensions, Hebrew explicitly among the 52 enhanced languages, official ONNX (and OpenVINO) weights, no prefixes, CLS pooling, released 2026-04-29.
- **multilingual-e5-small:** MIT, 384 dimensions, 12 layers, 512-token maximum, `query:`/`passage:` prefixes required, mean pooling, ONNX in the repo, Hebrew (`he`) in its language list.
- **python-docx:** 1.2.0, MIT, Python ≥ 3.9. The last release was June 2025, which is fine for a stable format.
- **NumPy `.npy`:** Plain float32 save/load is supported, and `allow_pickle` defaults to False (NumPy 2.5 docs).
- **AD-8 model-change rebuild via manifest** is the correct response to incompatible embedding spaces. Both models are 384-dimensional, so a dimension check alone would **not** catch a model swap. The model-id check is what catches it, which the spine already includes.
- **Installer budget (NFR-7):** The rough total stays under 1 GB. It is about 127 MB WebView2 + 98–390 MB model + roughly 100–200 MB Python, ORT, NumPy and tokenizers + the UI.
