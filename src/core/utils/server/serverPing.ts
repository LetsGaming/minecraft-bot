/**
 * Minecraft Server List Ping — asking the game server itself, with no wrapper
 * in between.
 *
 * Why this exists: every other channel in this bot goes through the API
 * wrapper, so when the wrapper is down the bot's honest answer was "I cannot
 * tell you anything about this server". That is a poor answer when a player
 * can open their multiplayer list and see the server sitting there with four
 * people on it. The information was always available; the bot just had one
 * route to it.
 *
 * This is the same handshake a vanilla client performs to draw a row in the
 * server list (protocol 1.7+, `next state = 1`). It needs no authentication,
 * no plugin, and no cooperation from anything but the server itself, and it
 * returns the live player count, the maximum, and — when the server publishes
 * one — a sample of names.
 *
 * Two limits worth knowing, because callers must not over-read the result:
 *
 *   - The name sample is capped by the server (usually 12) and can be
 *     disabled or anonymised outright by plugins. It is a *sample*, never the
 *     roster. The counts are exact; the names are best-effort.
 *   - Netty's IO threads answer this, so a status reply proves the server
 *     process is alive and serving connections. It does not prove the main
 *     game thread is healthy — that is what RCON responsiveness is for.
 *
 * The module is pure protocol: no config, no Discord, no game knowledge, and
 * no dependency on the wrapper. Callers pass a host and port.
 */
import net from "net";

/** Default `server-port` in server.properties. */
export const DEFAULT_MINECRAFT_PORT = 25565;

/** Protocol version sent in the handshake. -1 means "just tell me your status". */
const HANDSHAKE_PROTOCOL_VERSION = -1;

/** Status is served off the IO threads, so this can be tight. */
export const DEFAULT_PING_TIMEOUT_MS = 3_000;

/**
 * Refuse to buffer more than this. A status response carrying a favicon is
 * ~10-30 KB; anything past a quarter of a megabyte is a misconfigured or
 * hostile peer, not a Minecraft server.
 */
const MAX_RESPONSE_BYTES = 256 * 1024;

export interface ServerPingResult {
  players: {
    online: number;
    max: number;
    /** Best-effort, capped by the server, often empty. Never a full roster. */
    sample: string[];
  };
  /** Reported version name, e.g. "1.21.4". Null when the server omits it. */
  version: string | null;
  /** Round-trip time for the status exchange. */
  latencyMs: number;
}

/**
 * The outcome of one ping, as a value rather than an exception — the caller's
 * whole job is to distinguish these, so throwing would flatten exactly the
 * information it needs.
 */
export type PingOutcome =
  /** The server answered. It is up and serving connections. */
  | { kind: "status"; result: ServerPingResult }
  /**
   * TCP connected but no status came back inside the budget. Something is
   * listening on that port — a server with `enable-status=false`, one still
   * starting, or a proxy — so this is evidence of life, not of health.
   */
  | { kind: "connected" }
  /** Actively refused, or no route. The strongest evidence of "not running". */
  | { kind: "refused"; reason: string }
  /** Anything else: DNS failure, a non-Minecraft peer, a malformed reply. */
  | { kind: "error"; reason: string };

// ── VarInt ────────────────────────────────────────────────────────────────
// Minecraft's variable-length integer: seven bits of payload per byte, high
// bit set while more bytes follow.

export function encodeVarInt(value: number): Buffer {
  const bytes: number[] = [];
  let remaining = value >>> 0; // two's complement, so -1 encodes as 5 bytes
  for (;;) {
    if ((remaining & ~0x7f) === 0) {
      bytes.push(remaining);
      return Buffer.from(bytes);
    }
    bytes.push((remaining & 0x7f) | 0x80);
    remaining >>>= 7;
  }
}

export interface VarIntRead {
  value: number;
  /** Bytes consumed. */
  size: number;
}

/**
 * Read a VarInt at `offset`. Returns null when the buffer does not yet hold a
 * complete one — the caller is streaming and should wait for more bytes.
 * Throws only for a VarInt that cannot be valid at any length.
 */
export function readVarInt(buf: Buffer, offset = 0): VarIntRead | null {
  let value = 0;
  let size = 0;
  for (;;) {
    if (offset + size >= buf.length) return null; // incomplete, not invalid
    const byte = buf[offset + size]!;
    value |= (byte & 0x7f) << (7 * size);
    size++;
    if ((byte & 0x80) === 0) return { value, size };
    if (size > 5) throw new Error("VarInt is longer than 5 bytes");
  }
}

/** Length-prefixed UTF-8, the protocol's String type. */
function encodeString(text: string): Buffer {
  const body = Buffer.from(text, "utf-8");
  return Buffer.concat([encodeVarInt(body.length), body]);
}

/** Prefix a packet body with its own length, as the protocol frames every packet. */
function frame(body: Buffer): Buffer {
  return Buffer.concat([encodeVarInt(body.length), body]);
}

/**
 * The two packets a status ping consists of, sent back to back.
 *
 * Exported so the encoding can be tested without a socket — this is the part
 * that is easy to get subtly wrong and impossible to notice, because a
 * malformed handshake looks exactly like an unreachable server.
 */
export function buildStatusRequest(host: string, port: number): Buffer {
  const handshake = frame(
    Buffer.concat([
      encodeVarInt(0x00), // packet id: handshake
      encodeVarInt(HANDSHAKE_PROTOCOL_VERSION),
      encodeString(host),
      (() => {
        const b = Buffer.alloc(2);
        b.writeUInt16BE(port);
        return b;
      })(),
      encodeVarInt(1), // next state: status
    ]),
  );
  const statusRequest = frame(encodeVarInt(0x00));
  return Buffer.concat([handshake, statusRequest]);
}

// ── Response parsing ──────────────────────────────────────────────────────

interface RawStatus {
  version?: { name?: unknown };
  players?: { max?: unknown; online?: unknown; sample?: unknown };
}

/**
 * Pull the status document out of a framed response, or null when the buffer
 * is still short of a complete packet.
 *
 * Deliberately narrowed field by field rather than cast: unlike the wrapper,
 * this speaks to an arbitrary server that may be modded, proxied, or not a
 * Minecraft server at all, so nothing here may be assumed about its shape.
 */
export function parseStatusResponse(
  buf: Buffer,
): { players: { online: number; max: number; sample: string[] }; version: string | null } | null {
  const length = readVarInt(buf, 0);
  if (!length) return null;
  const total = length.size + length.value;
  if (buf.length < total) return null;

  const packetId = readVarInt(buf, length.size);
  if (!packetId) return null;
  if (packetId.value !== 0x00) {
    throw new Error(`unexpected status packet id 0x${packetId.value.toString(16)}`);
  }

  const jsonStart = length.size + packetId.size;
  const jsonLength = readVarInt(buf, jsonStart);
  if (!jsonLength) return null;

  const bodyStart = jsonStart + jsonLength.size;
  const body = buf.toString("utf-8", bodyStart, bodyStart + jsonLength.value);

  const parsed = JSON.parse(body) as unknown;
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("status document is not an object");
  }
  const status = parsed as RawStatus;

  const online = Number(status.players?.online);
  const max = Number(status.players?.max);
  const sample = Array.isArray(status.players?.sample)
    ? (status.players.sample as Array<{ name?: unknown }>)
        .map((entry) => entry?.name)
        .filter((name): name is string => typeof name === "string")
    : [];

  return {
    players: {
      online: Number.isFinite(online) ? online : 0,
      max: Number.isFinite(max) ? max : 0,
      sample,
    },
    version:
      typeof status.version?.name === "string" ? status.version.name : null,
  };
}

// ── The ping ──────────────────────────────────────────────────────────────

/**
 * Ping a Minecraft server. Never throws — every failure is a PingOutcome,
 * because "refused" and "connected but silent" mean different things to the
 * caller and an exception would collapse them.
 */
export function pingMinecraftServer(
  host: string,
  port: number = DEFAULT_MINECRAFT_PORT,
  timeoutMs: number = DEFAULT_PING_TIMEOUT_MS,
): Promise<PingOutcome> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const startedAt = Date.now();
    let buffer = Buffer.alloc(0);
    let connected = false;
    let settled = false;

    const finish = (outcome: PingOutcome): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(outcome);
    };

    socket.setTimeout(timeoutMs);

    socket.once("connect", () => {
      connected = true;
      socket.write(buildStatusRequest(host, port));
    });

    // The socket is never set to an encoding, so `data` is always a Buffer;
    // the handler's declared type is the union for the string-encoding case.
    socket.on("data", (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length > MAX_RESPONSE_BYTES) {
        finish({ kind: "error", reason: "status response too large" });
        return;
      }
      try {
        const status = parseStatusResponse(buffer);
        if (!status) return; // keep reading — the packet is incomplete
        finish({
          kind: "status",
          result: { ...status, latencyMs: Date.now() - startedAt },
        });
      } catch (err) {
        finish({
          kind: "error",
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    });

    socket.once("timeout", () => {
      // Connected but silent is a different fact from never connecting: one
      // says a process is listening, the other says nothing is.
      finish(
        connected
          ? { kind: "connected" }
          : { kind: "refused", reason: "connect timed out" },
      );
    });

    socket.once("error", (err) => {
      const reason = err.message;
      const code = (err as NodeJS.ErrnoException).code ?? "";
      const isRefusal =
        code === "ECONNREFUSED" ||
        code === "EHOSTUNREACH" ||
        code === "ENETUNREACH";
      finish(
        isRefusal && !connected
          ? { kind: "refused", reason }
          : { kind: "error", reason },
      );
    });

    socket.once("close", () => {
      // The server hung up before answering — treat as connected-but-silent
      // when the TCP handshake had completed, otherwise as a refusal.
      finish(
        connected
          ? { kind: "connected" }
          : { kind: "refused", reason: "closed before reply" },
      );
    });

    socket.connect(port, host);
  });
}
