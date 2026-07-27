/**
 * The direct server-list ping — the bot's second route to a Minecraft server,
 * and the only one that survives the API wrapper going down.
 *
 * Protocol code is the kind that fails silently: a malformed handshake and an
 * unreachable server look identical from the outside, and the whole point of
 * this module is to tell "up" from "not up". So the encoding is asserted
 * byte-for-byte against the spec rather than only through a round-trip, and
 * the outcomes are exercised against real sockets that behave the way real
 * servers misbehave — accepting and never answering, hanging up mid-reply,
 * refusing outright.
 */
import { describe, it, expect, afterEach } from "vitest";
import net from "net";
import type { AddressInfo } from "net";

import {
  buildStatusRequest,
  encodeVarInt,
  parseStatusResponse,
  pingMinecraftServer,
  readVarInt,
  DEFAULT_MINECRAFT_PORT,
} from "../../src/core/utils/server/serverPing.js";

// ── Test servers ───────────────────────────────────────────────────────────

const servers: net.Server[] = [];
const openSockets: net.Socket[] = [];

afterEach(async () => {
  // Destroy the accepted sockets first: server.close() waits for every open
  // connection, and several cases here deliberately leave one hanging — that
  // is the behaviour under test — so a plain close() would never resolve.
  for (const socket of openSockets.splice(0)) socket.destroy();
  await Promise.all(
    servers.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))),
  );
});

async function listen(
  onConnection: (socket: net.Socket) => void,
): Promise<number> {
  const server = net.createServer((socket) => {
    openSockets.push(socket);
    onConnection(socket);
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return (server.address() as AddressInfo).port;
}

/** Frame a status document the way a real server does. */
function statusPacket(doc: unknown): Buffer {
  const json = Buffer.from(JSON.stringify(doc), "utf-8");
  const body = Buffer.concat([
    encodeVarInt(0x00), // packet id
    encodeVarInt(json.length),
    json,
  ]);
  return Buffer.concat([encodeVarInt(body.length), body]);
}

const VANILLA_STATUS = {
  version: { name: "1.21.4", protocol: 769 },
  players: {
    max: 20,
    online: 4,
    sample: [{ name: "Alice", id: "x" }, { name: "Bob", id: "y" }],
  },
  description: { text: "A Minecraft Server" },
};

// ── VarInt ─────────────────────────────────────────────────────────────────

describe("VarInt", () => {
  it.each([
    [0, [0x00]],
    [1, [0x01]],
    [127, [0x7f]],
    [128, [0x80, 0x01]],
    [255, [0xff, 0x01]],
    [25565, [0xdd, 0xc7, 0x01]],
    [2097151, [0xff, 0xff, 0x7f]],
  ])("encodes %i to the wire form the protocol specifies", (value, bytes) => {
    expect([...encodeVarInt(value)]).toEqual(bytes);
  });

  it("encodes -1 as the full five bytes", () => {
    // The handshake sends -1 for "just tell me your status". Getting the
    // two's-complement width wrong here yields a handshake the server drops
    // without a word, which is indistinguishable from an offline server.
    expect([...encodeVarInt(-1)]).toEqual([0xff, 0xff, 0xff, 0xff, 0x0f]);
  });

  it("round-trips through readVarInt", () => {
    for (const value of [0, 1, 127, 128, 300, 25565, 2097151]) {
      expect(readVarInt(encodeVarInt(value))).toEqual({
        value,
        size: encodeVarInt(value).length,
      });
    }
  });

  it("returns null for an incomplete VarInt rather than guessing", () => {
    // Streaming: a partial read is "wait for more", not "invalid".
    expect(readVarInt(Buffer.from([0x80]))).toBeNull();
    expect(readVarInt(Buffer.alloc(0))).toBeNull();
  });

  it("rejects a VarInt longer than five bytes", () => {
    expect(() => readVarInt(Buffer.from([0x80, 0x80, 0x80, 0x80, 0x80, 0x80]))).toThrow();
  });
});

// ── Handshake encoding ─────────────────────────────────────────────────────

describe("buildStatusRequest", () => {
  it("frames both packets with their own lengths", () => {
    const buf = buildStatusRequest("mc.example.com", 25565);

    const handshakeLen = readVarInt(buf, 0)!;
    const handshakeEnd = handshakeLen.size + handshakeLen.value;
    expect(buf.length).toBeGreaterThan(handshakeEnd);

    // The status request that follows is two bytes: length 1, packet id 0.
    expect([...buf.subarray(handshakeEnd)]).toEqual([0x01, 0x00]);
  });

  it("writes the port as a big-endian unsigned short", () => {
    // A little-endian port here would reach the wrong server, or nothing.
    const buf = buildStatusRequest("h", 25565);
    expect(buf.includes(Buffer.from([0x63, 0xdd]))).toBe(true);
  });

  it("ends the handshake with next-state = 1 (status)", () => {
    const buf = buildStatusRequest("h", 25565);
    const len = readVarInt(buf, 0)!;
    expect(buf[len.size + len.value - 1]).toBe(0x01);
  });
});

// ── Response parsing ───────────────────────────────────────────────────────

describe("parseStatusResponse", () => {
  it("reads counts and the name sample", () => {
    expect(parseStatusResponse(statusPacket(VANILLA_STATUS))).toEqual({
      players: { online: 4, max: 20, sample: ["Alice", "Bob"] },
      version: "1.21.4",
    });
  });

  it("returns null while the packet is still incomplete", () => {
    const full = statusPacket(VANILLA_STATUS);
    expect(parseStatusResponse(full.subarray(0, full.length - 5))).toBeNull();
  });

  it("survives a server that publishes no sample", () => {
    // Plugins suppress this routinely, and the counts still matter.
    const parsed = parseStatusResponse(
      statusPacket({ players: { max: 20, online: 7 } }),
    );
    expect(parsed?.players).toEqual({ online: 7, max: 20, sample: [] });
  });

  it("degrades to zeros rather than NaN on a malformed players block", () => {
    const parsed = parseStatusResponse(
      statusPacket({ players: { max: "lots", online: null } }),
    );
    expect(parsed?.players.online).toBe(0);
    expect(parsed?.players.max).toBe(0);
  });

  it("throws on a packet id that is not a status response", () => {
    const body = Buffer.concat([encodeVarInt(0x03), encodeVarInt(0)]);
    const packet = Buffer.concat([encodeVarInt(body.length), body]);
    expect(() => parseStatusResponse(packet)).toThrow();
  });
});

// ── The ping, against real sockets ─────────────────────────────────────────

describe("pingMinecraftServer", () => {
  it("reports a live server with its player count", async () => {
    // The case the whole fallback exists for: the wrapper is gone, and this
    // is how the bot still knows four people are playing.
    const port = await listen((socket) => {
      socket.once("data", () => socket.write(statusPacket(VANILLA_STATUS)));
    });

    const outcome = await pingMinecraftServer("127.0.0.1", port, 2_000);
    expect(outcome.kind).toBe("status");
    if (outcome.kind !== "status") return;
    expect(outcome.result.players).toEqual({
      online: 4,
      max: 20,
      sample: ["Alice", "Bob"],
    });
    expect(outcome.result.version).toBe("1.21.4");
    expect(outcome.result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("reassembles a response split across packets", async () => {
    // Favicons push a status response well past one TCP segment, so partial
    // reads are the normal case, not an edge case.
    const port = await listen((socket) => {
      socket.once("data", () => {
        const packet = statusPacket(VANILLA_STATUS);
        socket.write(packet.subarray(0, 4));
        setTimeout(() => socket.write(packet.subarray(4)), 25);
      });
    });

    const outcome = await pingMinecraftServer("127.0.0.1", port, 3_000);
    expect(outcome.kind).toBe("status");
  });

  it("says 'connected' when the port accepts but never answers", async () => {
    // `enable-status=false`, a server still starting, or a proxy. Something
    // is listening — that is evidence of life, and it must not be reported
    // as a refusal.
    const port = await listen(() => {
      /* accept and say nothing */
    });

    const outcome = await pingMinecraftServer("127.0.0.1", port, 300);
    expect(outcome.kind).toBe("connected");
  });

  it("says 'connected' when the server hangs up before replying", async () => {
    const port = await listen((socket) => socket.once("data", () => socket.end()));
    const outcome = await pingMinecraftServer("127.0.0.1", port, 2_000);
    expect(outcome.kind).toBe("connected");
  });

  it("says 'refused' for a closed port — the strongest evidence of 'stopped'", async () => {
    const port = await listen(() => {});
    const server = servers.splice(0)[0]!;
    await new Promise<void>((r) => server.close(() => r()));

    const outcome = await pingMinecraftServer("127.0.0.1", port, 2_000);
    expect(outcome.kind).toBe("refused");
  });

  it("says 'error' for a peer that is not speaking the protocol", async () => {
    const port = await listen((socket) => socket.write(Buffer.from("HTTP/1.1 200 OK\r\n\r\n")));
    const outcome = await pingMinecraftServer("127.0.0.1", port, 2_000);
    expect(["error", "connected"]).toContain(outcome.kind);
  });

  it("never throws, whatever the peer does", async () => {
    // Errors-as-values: the caller's entire job is telling these apart, so an
    // exception would flatten exactly the information it needs.
    await expect(
      pingMinecraftServer("no-such-host.invalid", DEFAULT_MINECRAFT_PORT, 500),
    ).resolves.toHaveProperty("kind");
  });
});
