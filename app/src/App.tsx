import { useEffect, useState } from "react";
import { EngineBanner } from "./components/EngineBanner";
import { EngineSession, type EngineSnapshot } from "./engine/session";
import { ProtocolClient, tauriTransport } from "./protocol/client";

// Plain developer status until Story 1.3 brings the real layout; only the banner is user text.
const ECHO_TEXT = "סיכום ישיבה";

type PingState = "pending" | "ok" | "failed";

export default function App() {
  const [engine, setEngine] = useState<EngineSnapshot | null>(null);
  const [ping, setPing] = useState<PingState>("pending");

  useEffect(() => {
    const client = new ProtocolClient(tauriTransport());
    const session = new EngineSession(client);
    let active = true;

    setEngine(session.snapshot);
    session.subscribe(setEngine);
    // Dev check from Story 1.1: a Hebrew ping round-trip after every ready.
    client.onEvent((event) => {
      if (event.type !== "ready" || !active) return;
      setPing("pending");
      client
        .request({ type: "ping", text: ECHO_TEXT })
        .then((reply) => {
          if (active) setPing(reply.type === "pong" && reply.text === ECHO_TEXT ? "ok" : "failed");
        })
        .catch(() => {
          if (active) setPing("failed");
        });
    });
    void session.start();

    return () => {
      active = false;
      session.stop();
    };
  }, []);

  const ready = engine?.protocolVersion != null;
  return (
    <main className="flex flex-col gap-4 p-6 font-mono text-sm leading-relaxed">
      <EngineBanner visible={engine?.bannerVisible ?? false} />
      <div>
        <p>Engine: {engine?.state ?? "starting"}</p>
        {ready && <p>Protocol version: {engine.protocolVersion}</p>}
        {ready && <p>Ping: {ping}</p>}
        {engine?.status && (
          <p>
            Status: {engine.status.phase}, {engine.status.documentCount} documents
          </p>
        )}
      </div>
    </main>
  );
}
