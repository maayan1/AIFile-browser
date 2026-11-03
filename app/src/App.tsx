import { useEffect, useState } from "react";
import { AppShell } from "./components/shell/AppShell";
import { EngineSession } from "./engine/session";
import { ProtocolClient, tauriTransport } from "./protocol/client";

// Dev-only check from Story 1.1: a Hebrew ping round-trip after every ready, logged to the console.
const ECHO_TEXT = "סיכום ישיבה";

export default function App() {
  const [bannerVisible, setBannerVisible] = useState(false);

  useEffect(() => {
    const client = new ProtocolClient(tauriTransport());
    const session = new EngineSession(client);
    let active = true;

    session.subscribe((snapshot) => {
      setBannerVisible(snapshot.bannerVisible);
      // Dev readout (was on screen in 1.1/1.2): engine state, protocol version and status.
      if (import.meta.env.DEV) {
        const { state, protocolVersion, status } = snapshot;
        console.info("[engine]", { state, protocolVersion, status });
      }
    });

    if (import.meta.env.DEV) {
      client.onEvent((event) => {
        if (event.type !== "ready" || !active) return;
        client
          .request({ type: "ping", text: ECHO_TEXT })
          .then((reply) => {
            if (!active) return;
            const ok = reply.type === "pong" && reply.text === ECHO_TEXT;
            console.info("[engine] Hebrew ping:", ok ? "ok" : "failed", reply);
          })
          .catch((err: unknown) => {
            if (active) console.info("[engine] Hebrew ping failed:", err);
          });
      });
    }

    void session.start();

    return () => {
      active = false;
      session.stop();
    };
  }, []);

  return <AppShell bannerVisible={bannerVisible} />;
}
