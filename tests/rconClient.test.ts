/**
 * RconClient integration tests — uses a real in-process TCP mock RCON server.
 *
 * A real TCP server is used instead of mocking net.Socket internals because
 * socket mocks couple tests to the implementation (event names, buffer
 * handling, call order).  A real server tests the observable contract:
 *   "given this server response, what does the client do?"
 * That contract stays valid across internal refactors.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import net from "net";

vi.mock("../src/common/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { RconClient } from "../src/common/rcon/RconClient.js";

// ── RCON wire-format helpers ───────────────────────────────────────────────

function encode(id: number, type: number, body: string): Buffer {
  const b = Buffer.from(body, "utf-8");
  const len = 4 + 4 + b.length + 2;
  const buf = Buffer.alloc(4 + len);
  buf.writeInt32LE(len, 0);
  buf.writeInt32LE(id, 4);
  buf.writeInt32LE(type, 8);
  b.copy(buf, 12);
  return buf;
}

function decode(
  buf: Buffer,
): { id: number; type: number; body: string; size: number } | null {
  if (buf.length < 14) return null;
  const len = buf.readInt32LE(0);
  if (buf.length < 4 + len) return null;
  return {
    id: buf.readInt32LE(4),
    type: buf.readInt32LE(8),
    body: buf.toString("utf-8", 12, 4 + len - 2),
    size: 4 + len,
  };
}

// ── Mock RCON server ───────────────────────────────────────────────────────

interface MockServer {
  port: number;
  /** Override command → reply. Default: echo the command back. */
  responses: Map<string, string>;
  /** Commands in this set are received but not replied to (for timeout tests). */
  silent: Set<string>;
  authCount: number;
  close(): Promise<void>;
}

function startMockServer(password: string): Promise<MockServer> {
  const responses = new Map<string, string>();
  const silent = new Set<string>();
  let authCount = 0;

  return new Promise((resolve) => {
    const srv = net.createServer((socket) => {
      let buf = Buffer.alloc(0);
      socket.on("data", (chunk) => {
        buf = Buffer.concat([buf, chunk]);
        let pkt;
        while ((pkt = decode(buf))) {
          buf = buf.subarray(pkt.size);
          if (pkt.type === 3) {
            // AUTH
            authCount++;
            socket.write(
              pkt.body === password
                ? encode(pkt.id, 2, "") // success: same id
                : encode(-1, 2, ""), // failure: id = -1
            );
          } else if (pkt.type === 2) {
            // CMD
            if (silent.has(pkt.body)) continue; // intentionally no reply
            const reply = responses.get(pkt.body) ?? `OK:${pkt.body}`;
            socket.write(encode(pkt.id, 2, reply));
          }
        }
      });
    });

    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as net.AddressInfo;
      resolve({
        port,
        responses,
        silent,
        get authCount() {
          return authCount;
        },
        close: () => new Promise<void>((r) => srv.close(() => r())),
      });
    });
  });
}

// ── Fixtures ───────────────────────────────────────────────────────────────

const PW = "s3cret";
let srv: MockServer;
let client: RconClient;

beforeEach(async () => {
  srv = await startMockServer(PW);
  client = new RconClient("127.0.0.1", srv.port, PW, "test");
});

afterEach(async () => {
  client.disconnect();
  await srv.close();
});

// ── connect() ─────────────────────────────────────────────────────────────

describe("connect()", () => {
  it("resolves when the correct password is provided", async () => {
    await expect(client.connect()).resolves.toBeUndefined();
  });

  it("rejects when the wrong password is provided", async () => {
    const bad = new RconClient("127.0.0.1", srv.port, "wrong", "bad");
    await expect(bad.connect()).rejects.toThrow();
  });

  it("rejects when nothing is listening on the port", async () => {
    const dead = new RconClient("127.0.0.1", 1, PW, "dead");
    await expect(dead.connect()).rejects.toThrow();
  });

  it("returns immediately on a second call — no extra handshake", async () => {
    await client.connect();
    const before = srv.authCount;
    await client.connect();
    expect(srv.authCount).toBe(before);
  });

  it("handles concurrent calls: all settle, only one handshake", async () => {
    await Promise.all([client.connect(), client.connect(), client.connect()]);
    expect(srv.authCount).toBe(1);
  });
});

// ── send() ────────────────────────────────────────────────────────────────

describe("send()", () => {
  it("auto-connects and returns the server response", async () => {
    srv.responses.set(
      "list",
      "There are 2 of a max of 20 players online: Alice, Bob",
    );
    await expect(client.send("list")).resolves.toBe(
      "There are 2 of a max of 20 players online: Alice, Bob",
    );
  });

  it("records lastSuccessTime after a successful command", async () => {
    const before = Date.now();
    await client.send("ping");
    expect(client.lastSuccessTime).toBeGreaterThanOrEqual(before);
  });

  it("handles concurrent commands without id collision", async () => {
    srv.responses.set("cmd1", "reply1");
    srv.responses.set("cmd2", "reply2");
    const [r1, r2] = await Promise.all([
      client.send("cmd1"),
      client.send("cmd2"),
    ]);
    expect(r1).toBe("reply1");
    expect(r2).toBe("reply2");
  });

  it("rejects with a timeout error when the server never responds to a command", async () => {
    // authenticate first so the timeout is only for the command, not the handshake
    await client.connect();
    srv.silent.add("slow_cmd");
    await expect(client.send("slow_cmd", 150)).rejects.toThrow(/timeout/i);
  });
});

// ── trySend() ─────────────────────────────────────────────────────────────

describe("trySend()", () => {
  it("returns the response string on success", async () => {
    srv.responses.set("seed", "Seed: [987654321]");
    await expect(client.trySend("seed")).resolves.toBe("Seed: [987654321]");
  });

  it("returns null instead of throwing when the connection fails", async () => {
    const dead = new RconClient("127.0.0.1", 1, PW, "dead");
    await expect(dead.trySend("anything", 100)).resolves.toBeNull();
  });

  it("returns null instead of throwing on command timeout", async () => {
    await client.connect();
    srv.silent.add("stall");
    await expect(client.trySend("stall", 150)).resolves.toBeNull();
  });
});

// ── disconnect() ──────────────────────────────────────────────────────────

describe("disconnect()", () => {
  it("does not throw when called before connecting", () => {
    expect(() => client.disconnect()).not.toThrow();
  });

  it("does not throw when called after connecting", async () => {
    await client.connect();
    expect(() => client.disconnect()).not.toThrow();
  });

  it("allows subsequent send() to reconnect transparently", async () => {
    await client.connect();
    client.disconnect();
    srv.responses.set("list", "There are 0 players online");
    await expect(client.send("list")).resolves.toBe(
      "There are 0 players online",
    );
  });
});
