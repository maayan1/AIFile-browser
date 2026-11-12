import { describe, expect, it } from "vitest";
import confSource from "../src-tauri/tauri.conf.json?raw";

// NFR-1: the app makes no network connections (docs/network-check.md). Two config rules keep it so:
// 1. WebView2 browser args. Unset, wry passes `--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection`;
//    a set value replaces those defaults entirely, so it must re-include all three.
// 2. The CSP lets the page load only local content, and connect-src allows only Tauri IPC.
const REQUIRED_DISABLED = ["msWebOOUI", "msPdfOOUI", "msSmartScreenProtection"];
const ALLOWED_CONNECT = new Set(["ipc:", "http://ipc.localhost"]);
const FETCH_DIRECTIVES = [
  "default-src", "script-src", "style-src", "img-src", "font-src", "connect-src",
  "media-src", "frame-src", "worker-src", "child-src", "object-src", "manifest-src",
];
const LOCAL_SOURCES = new Set(["'self'", "'none'", "'unsafe-inline'", "'unsafe-eval'", "data:", "blob:", ...ALLOWED_CONNECT]);

type Csp = string | Record<string, string | string[]> | null | undefined;
interface Conf {
  app: { windows: { label?: string; additionalBrowserArgs?: string | null }[]; security: { csp?: Csp; devCsp?: Csp } };
}

/** A feature name without Chromium's `:param/value` or `<Trial` suffix. */
const featureName = (f: string) => f.split("<")[0].split(":")[0].trim();

/** Why a window's `additionalBrowserArgs` breaks the rule, or null when it is unset or keeps the defaults. */
function browserArgsProblem(args: string | null | undefined): string | null {
  if (args == null) return null;
  const values = (name: string) =>
    [...args.matchAll(new RegExp(String.raw`(?:^|\s)--${name}=("?)([^\s"]*)\1`, "g"))].map((m) => m[2]);
  const disabled = values("disable-features");
  if (disabled.length !== 1) return `needs exactly one --disable-features, found ${disabled.length}`;
  const features = disabled[0].split(",").map(featureName);
  const missing = REQUIRED_DISABLED.filter((f) => !features.includes(f));
  if (missing.length) return `--disable-features is missing ${missing.join(", ")}`;
  const reEnabled = values("enable-features")
    .flatMap((v) => v.split(","))
    .map(featureName)
    .filter((f) => REQUIRED_DISABLED.includes(f));
  if (reEnabled.length) return `--enable-features turns back on ${reEnabled.join(", ")}`;
  return null;
}

/** The directives of a CSP (string or Tauri's directive map), name -> sources. */
function directives(csp: Csp): Map<string, string[]> {
  const found = new Map<string, string[]>();
  if (csp == null) return found;
  if (typeof csp === "string") {
    for (const part of csp.split(";")) {
      const [name, ...sources] = part.trim().split(/\s+/);
      if (name) found.set(name.toLowerCase(), sources);
    }
    return found;
  }
  for (const [name, value] of Object.entries(csp)) {
    const sources = (Array.isArray(value) ? value : [value]).flatMap((v) => v.trim().split(/\s+/)).filter(Boolean);
    found.set(name.toLowerCase(), sources);
  }
  return found;
}

/** Why a CSP lets the page reach the network, or null when it doesn't. */
function cspProblem(csp: Csp): string | null {
  const all = directives(csp);
  const connect = all.get("connect-src");
  if (connect === undefined) return "no connect-src directive";
  const extraConnect = connect.filter((s) => !ALLOWED_CONNECT.has(s));
  if (extraConnect.length) return `connect-src also allows ${extraConnect.join(" ")}`;
  for (const name of FETCH_DIRECTIVES) {
    const remote = (all.get(name) ?? []).filter((s) => !LOCAL_SOURCES.has(s.toLowerCase()));
    if (remote.length) return `${name} allows ${remote.join(" ")}`;
  }
  return null;
}

const conf = JSON.parse(confSource) as Conf;

describe("network rules", () => {
  it("reads the windows from tauri.conf.json", () => {
    expect(conf.app.windows.length).toBeGreaterThan(0);
  });

  it.each(conf.app.windows.map((w, i) => [w.label ?? String(i), w] as const))(
    "window %s keeps WebView2's SmartScreen and OOUI features off",
    (_label, window) => {
      expect(browserArgsProblem(window.additionalBrowserArgs)).toBeNull();
    },
  );

  it("limits the CSP to local content and connect-src to Tauri IPC", () => {
    expect(cspProblem(conf.app.security.csp)).toBeNull();
    // devCsp null means `tauri dev` uses csp too; if one is ever set it follows the same rule.
    if (conf.app.security.devCsp != null) expect(cspProblem(conf.app.security.devCsp)).toBeNull();
  });

  it("catches bad browser args and lets good ones through", () => {
    const good = [
      undefined,
      null,
      "--disable-features=msWebOOUI:mode/off,msPdfOOUI,msSmartScreenProtection<Trial",
      "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection",
      '--disable-features="msSmartScreenProtection,msWebOOUI,msPdfOOUI,msEdgeTranslate" --no-first-run',
    ];
    for (const sample of good) expect(browserArgsProblem(sample), String(sample)).toBeNull();
    const bad = [
      "",
      "--no-first-run",
      "--disable-features=msWebOOUI,msPdfOOUI",
      "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtectionX",
      "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --disable-features=msEdgeTranslate",
      "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --enable-features=msSmartScreenProtection",
      "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --enable-features=msSmartScreenProtection:level/1",
      "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --enable-features=msPdfOOUI<SomeTrial",
      "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --enable-features=Foo,msWebOOUI<Trial:x/y",
    ];
    for (const sample of bad) expect(browserArgsProblem(sample), sample).not.toBeNull();
  });

  it("catches a CSP that reaches beyond the app", () => {
    const ok = "default-src 'self'; connect-src ipc: http://ipc.localhost; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'";
    expect(cspProblem(ok)).toBeNull();
    expect(cspProblem({ "default-src": "'self'", "connect-src": ["ipc:", "http://ipc.localhost"], "object-src": "'none'" })).toBeNull();
    for (const sample of [
      "default-src 'self'",
      "default-src 'self'; connect-src ipc: http://ipc.localhost https://example.com",
      "connect-src *",
      "connect-src 'self' ipc:",
      { "connect-src": "ipc: wss:" },
      null,
      "default-src 'self'; connect-src ipc: http://ipc.localhost; img-src 'self' https:",
      "default-src 'self'; connect-src ipc: http://ipc.localhost; font-src https://fonts.gstatic.com",
      "default-src *; connect-src ipc:",
      { "connect-src": "ipc:", "script-src": ["'self'", "https://cdn.example.com"] },
      "connect-src ipc:; frame-src http://localhost:8080",
    ] as Csp[]) {
      expect(cspProblem(sample), JSON.stringify(sample)).not.toBeNull();
    }
  });
});
