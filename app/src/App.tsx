import { useEffect, useState } from "react";
import { ProtocolClient, tauriTransport } from "./protocol/client";

// Plain developer status until Story 1.3 brings the real layout and string catalog.
const ECHO_TEXT = "סיכום ישיבה";

type PingState = "pending" | "ok" | "failed";

export default function App() {
  const [protocolVersion, setProtocolVersion] = useState<number | null>(null);
  const [ping, setPing] = useState<PingState>("pending");

  useEffect(() => {
    const client = new ProtocolClient(tauriTransport());
    let active = true;

    client.onEvent((event) => {
      if (event.type !== "ready" || !active) return;
      setProtocolVersion(event.protocolVersion);
      client
        .request({ type: "ping", text: ECHO_TEXT })
        .then((reply) => {
          if (active) setPing(reply.type === "pong" && reply.text === ECHO_TEXT ? "ok" : "failed");
        })
        .catch(() => {
          if (active) setPing("failed");
        });
    });
    void client.start();

    return () => {
      active = false;
      client.stop();
    };
  }, []);

  return (
    <main className="p-6 font-mono text-sm leading-relaxed">
      <p>Engine: {protocolVersion === null ? "waiting…" : "ready"}</p>
      {protocolVersion !== null && <p>Protocol version: {protocolVersion}</p>}
      {protocolVersion !== null && <p>Ping: {ping}</p>}
    </main>
  );
}
