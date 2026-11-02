import Ajv from "ajv";
import { describe, expect, it } from "vitest";
import { ProtocolClient, type Transport } from "./client";

// Loaded through Vite so the test needs no Node file APIs.
const schemas = import.meta.glob<Record<string, unknown>>("../../../protocol/schemas/*.schema.json", {
  eager: true,
  import: "default",
});
const examples = import.meta.glob<Record<string, unknown>>("../../../protocol/examples/*.json", {
  eager: true,
  import: "default",
});
const codes = import.meta.glob<{ errorCodes: string[] }>("../../../protocol/codes.json", {
  eager: true,
  import: "default",
});

const ajv = new Ajv({ strict: true, allErrors: true });
const validators = new Map(
  Object.entries(schemas).map(([file, schema]) => [
    file.split("/").pop()!.replace(".schema.json", ""),
    ajv.compile(schema),
  ]),
);

describe("protocol examples", () => {
  it("finds schemas and examples", () => {
    expect(validators.size).toBeGreaterThan(0);
    expect(Object.keys(examples).length).toBeGreaterThan(0);
  });

  it.each(Object.entries(examples))("%s validates against the schema its type names", (_file, example) => {
    const validate = validators.get(example.type as string);
    expect(validate, `no schema for type ${String(example.type)}`).toBeDefined();
    const ok = validate!(example);
    expect(validate!.errors ?? []).toEqual([]);
    expect(ok).toBe(true);
  });

  it("uses only error codes listed in codes.json", () => {
    const listed = new Set(Object.values(codes)[0].errorCodes);
    for (const example of Object.values(examples)) {
      if (example.type === "error") expect(listed.has(example.code as string)).toBe(true);
    }
  });
});

function fakeTransport() {
  const sent: string[] = [];
  let onLine: (line: string) => void = () => {};
  const transport: Transport = {
    send: async (line) => {
      sent.push(line);
    },
    subscribe: async (handler) => {
      onLine = handler;
      return () => {
        onLine = () => {};
      };
    },
    lastReady: async () => '{"id":null,"type":"ready","protocolVersion":1}',
  };
  return { transport, sent, deliver: (line: string) => onLine(line) };
}

describe("ProtocolClient", () => {
  it("replays a ready that arrived before it subscribed", async () => {
    const { transport } = fakeTransport();
    const client = new ProtocolClient(transport);
    const events: unknown[] = [];
    client.onEvent((e) => events.push(e));
    await client.start();
    expect(events).toEqual([{ id: null, type: "ready", protocolVersion: 1 }]);
  });

  it("sends with a generated id and resolves the reply with the same id", async () => {
    const { transport, sent, deliver } = fakeTransport();
    let n = 0;
    const client = new ProtocolClient(transport, () => `t${++n}`);
    await client.start();
    const first = client.request({ type: "ping", text: "סיכום ישיבה" });
    const second = client.request({ type: "ping" });
    expect(sent.map((l) => JSON.parse(l))).toEqual([
      { type: "ping", text: "סיכום ישיבה", id: "t1" },
      { type: "ping", id: "t2" },
    ]);
    deliver('{"id":"t2","type":"pong"}');
    deliver('{"id":"t1","type":"pong","text":"סיכום ישיבה"}');
    await expect(first).resolves.toEqual({ id: "t1", type: "pong", text: "סיכום ישיבה" });
    await expect(second).resolves.toEqual({ id: "t2", type: "pong" });
  });

  it("delivers ready once when the live event arrives before the cached one is fetched", async () => {
    const readyLine = '{"id":null,"type":"ready","protocolVersion":1}';
    let onLine: (line: string) => void = () => {};
    const transport: Transport = {
      send: async () => {},
      subscribe: async (handler) => {
        onLine = handler;
        return () => {};
      },
      lastReady: async () => {
        onLine(readyLine); // live event lands between subscribe and lastReady
        return readyLine;
      },
    };
    const client = new ProtocolClient(transport);
    const events: unknown[] = [];
    client.onEvent((e) => events.push(e));
    await client.start();
    expect(events).toEqual([{ id: null, type: "ready", protocolVersion: 1 }]);
  });

  it("rejects a request whose send fails and ignores a later reply with its id", async () => {
    const failure = new Error("engine is not running");
    let onLine: (line: string) => void = () => {};
    const transport: Transport = {
      send: async () => {
        throw failure;
      },
      subscribe: async (handler) => {
        onLine = handler;
        return () => {};
      },
      lastReady: async () => null,
    };
    const client = new ProtocolClient(transport, () => "f1");
    const events: unknown[] = [];
    client.onEvent((e) => events.push(e));
    await client.start();
    await expect(client.request({ type: "ping" })).rejects.toBe(failure);
    expect(() => onLine('{"id":"f1","type":"pong"}')).not.toThrow();
    expect(events).toEqual([]);
    expect((client as unknown as { pending: Map<string, unknown> }).pending.size).toBe(0);
  });
});
