/**
 * DSH-01 — the SSE transport extracted from RemoteLogWatcher.
 *
 * This code shipped for a year inside the bot with no direct test: the watcher
 * was only ever exercised through Discord-shaped integration mocks, so frame
 * splitting and reconnect behaviour were never asserted. Moving it into core
 * to share with the dashboard is the moment to fix that, because a bug here
 * now breaks the chat bridge AND the console.
 *
 * The decoder is tested against hand-written chunk boundaries, which is where
 * this kind of code actually breaks.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  SseFrameDecoder,
  SseLineStream,
} from "../../src/core/utils/sseLineStream.js";

vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ── The decoder ─────────────────────────────────────────────────────────────

describe("SseFrameDecoder", () => {
  it("returns a complete frame's payload", () => {
    const d = new SseFrameDecoder();
    expect(d.push('data: {"line":"hello"}\n\n')).toEqual(['{"line":"hello"}']);
  });

  it("holds a partial frame until it completes", () => {
    const d = new SseFrameDecoder();
    expect(d.push('data: {"line":"hel')).toEqual([]);
    expect(d.push('lo"}\n\n')).toEqual(['{"line":"hello"}']);
  });

  it("survives a split mid-delimiter", () => {
    // The nastiest boundary: the blank line arrives across two chunks.
    const d = new SseFrameDecoder();
    expect(d.push('data: a\n')).toEqual([]);
    expect(d.push('\ndata: b\n\n')).toEqual(["a", "b"]);
  });

  it("returns several frames from one chunk", () => {
    const d = new SseFrameDecoder();
    expect(d.push("data: one\n\ndata: two\n\ndata: three\n\n")).toEqual([
      "one",
      "two",
      "three",
    ]);
  });

  it("ignores keep-alive comments and non-data fields", () => {
    const d = new SseFrameDecoder();
    expect(d.push(":\n\n")).toEqual([]);
    expect(d.push("event: ping\nid: 7\nretry: 100\n\n")).toEqual([]);
    expect(d.push("event: log\ndata: kept\n\n")).toEqual(["kept"]);
  });

  it("skips an empty data field rather than emitting an empty payload", () => {
    const d = new SseFrameDecoder();
    expect(d.push("data:\n\ndata:   \n\n")).toEqual([]);
  });

  it("tolerates a data payload containing a colon", () => {
    const d = new SseFrameDecoder();
    expect(d.push('data: {"line":"[19:22:01] joined"}\n\n')).toEqual([
      '{"line":"[19:22:01] joined"}',
    ]);
  });

  it("drops the partial frame on reset", () => {
    // Without the reset, the buffered "data: half" would fuse onto the next
    // chunk and emit a line that was never sent.
    const d = new SseFrameDecoder();
    d.push("data: half");
    d.reset();
    expect(d.push("data: rest\n\n")).toEqual(["rest"]);
  });
});

// ── The stream ──────────────────────────────────────────────────────────────

/** A ReadableStream that emits the given chunks, then ends. */
function bodyOf(...chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
}

function okResponse(...chunks: string[]): Response {
  return { ok: true, status: 200, body: bodyOf(...chunks) } as unknown as Response;
}

/** Let the microtask queue drain so the read loop can finish. */
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe("SseLineStream", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("emits each payload and reports connected", async () => {
    const seen: string[] = [];
    let connected = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => okResponse("data: a\n\ndata: b\n\n")),
    );

    const stream = new SseLineStream({
      url: "http://wrapper/stream",
      scope: "smp",
      onData: (p) => seen.push(p),
      onConnect: () => connected++,
    });
    stream.start();
    await settle();

    expect(seen).toEqual(["a", "b"]);
    expect(connected).toBe(1);
    stream.stop();
    expect(stream.state).toBe("stopped");
  });

  it("sends the configured headers on every attempt", async () => {
    const fetchMock = vi.fn(async () => okResponse("data: x\n\n"));
    vi.stubGlobal("fetch", fetchMock);

    const stream = new SseLineStream({
      url: "http://wrapper/stream",
      headers: { "x-api-key": "k-1" },
      scope: "smp",
      onData: () => {},
    });
    stream.start();
    await settle();

    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: { "x-api-key": "k-1" },
    });
    stream.stop();
  });

  it("schedules a reconnect when the connection fails", async () => {
    const reasons: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );

    const stream = new SseLineStream({
      url: "http://wrapper/stream",
      scope: "smp",
      onData: () => {},
      onDisconnect: (r) => reasons.push(r),
    });
    stream.start();
    await settle();

    expect(reasons[0]).toMatch(/connect failed/);
    expect(stream.state).toBe("reconnecting");
    stream.stop();
  });

  it("treats a non-2xx as a disconnect, not a crash", async () => {
    const reasons: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 503, body: null }) as unknown as Response),
    );

    const stream = new SseLineStream({
      url: "http://wrapper/stream",
      scope: "smp",
      onData: () => {},
      onDisconnect: (r) => reasons.push(r),
    });
    stream.start();
    await settle();

    expect(reasons[0]).toMatch(/bad response: 503/);
    stream.stop();
  });

  it("backs off exponentially, then reconnects", async () => {
    let attempts = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        attempts++;
        throw new Error("down");
      }),
    );

    const stream = new SseLineStream({
      url: "http://wrapper/stream",
      scope: "smp",
      onData: () => {},
    });
    stream.start();
    await settle();
    expect(attempts).toBe(1);

    // First retry after the 5s base delay.
    await vi.advanceTimersByTimeAsync(5_000);
    await settle();
    expect(attempts).toBe(2);

    // Second retry only after 10s — the delay doubled.
    await vi.advanceTimersByTimeAsync(5_000);
    await settle();
    expect(attempts).toBe(2);
    await vi.advanceTimersByTimeAsync(5_000);
    await settle();
    expect(attempts).toBe(3);

    stream.stop();
  });

  it("stop() cancels a pending reconnect", async () => {
    let attempts = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        attempts++;
        throw new Error("down");
      }),
    );

    const stream = new SseLineStream({
      url: "http://wrapper/stream",
      scope: "smp",
      onData: () => {},
    });
    stream.start();
    await settle();
    stream.stop();

    await vi.advanceTimersByTimeAsync(60_000);
    await settle();
    expect(attempts).toBe(1); // never retried
  });

  it("start() is idempotent", async () => {
    const fetchMock = vi.fn(async () => okResponse("data: a\n\n"));
    vi.stubGlobal("fetch", fetchMock);

    const stream = new SseLineStream({
      url: "http://wrapper/stream",
      scope: "smp",
      onData: () => {},
    });
    stream.start();
    stream.start();
    stream.start();
    await settle();

    // A second start() must not open a second socket — the dashboard's hub
    // calls it per subscriber and relies on this.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    stream.stop();
  });

  it("stays stopped when stop() lands during the handshake", async () => {
    // Regression: stop() aborts the controller, but if the response has
    // already resolved the abort is too late — _read() would go on to report
    // "connected", fire onConnect, and start reading a stream the caller had
    // cancelled. Found by this test when the transport was extracted.
    const seen: string[] = [];
    let connects = 0;
    vi.stubGlobal("fetch", vi.fn(async () => okResponse("data: a\n\n")));

    const stream = new SseLineStream({
      url: "http://wrapper/stream",
      scope: "smp",
      onData: (p) => seen.push(p),
      onConnect: () => connects++,
    });
    stream.start();
    stream.stop();
    await settle();
    await vi.advanceTimersByTimeAsync(30_000);

    expect(stream.state).toBe("stopped");
    expect(connects).toBe(0);
    expect(seen).toEqual([]);
  });
});
