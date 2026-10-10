/**
 * In-game command handler tests: !seed, !netherportal
 *
 * The defineCommand wrapper has a module-level `cooldowns` Map that persists
 * across tests. Using a unique username per test avoids the 5-second cooldown
 * gate — each username gets its own entry and starts with no history.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../src/bot/logWatcher/logWatcher.js", () => ({
  registerLogCommand: vi.fn(),
}));

import { registerLogCommand } from "../../src/bot/logWatcher/logWatcher.js";
import { DELIVERED } from "../fixtures/outcomes.js";

const FAIL = { ok: false, reason: "unreadable" };

type Handler = (
  m: RegExpExecArray,
  client: never,
  server: never,
) => Promise<void>;

function capture(): Promise<{ regex: RegExp; handler: Handler }> {
  return new Promise((resolve) => {
    vi.mocked(registerLogCommand).mockImplementationOnce((re, fn) => {
      resolve({ regex: re as RegExp, handler: fn as Handler });
    });
  });
}

// Unique username counter — avoids cooldown state leaking between tests
let _uid = 0;
const nextUser = () => `TestUser${++_uid}`;

// ── !seed ─────────────────────────────────────────────────────────────────

describe("!seed handler", () => {
  let regex: RegExp, handler: Handler;

  beforeEach(async () => {
    const p = capture();
    (await import("../../src/bot/logWatcher/commands/info/seed.js")).init();
    ({ regex, handler } = await p);
  });

  function run(username: string, server: never) {
    const m = regex.exec(`[12:00:00] [INFO]: <${username}> !seed`)!;
    return handler(m, null as never, server);
  }
  function makeSrv(seed: string | null) {
    return {
      getSeed: vi
        .fn()
        .mockResolvedValue(seed === null ? FAIL : { ok: true, value: seed }),
      send: vi.fn().mockResolvedValue(DELIVERED),
    } as never;
  }

  it("sends the seed to the player when getSeed succeeds", async () => {
    const s = makeSrv("987654321");
    await run(nextUser(), s);
    expect(s.send).toHaveBeenCalledWith(
      expect.stringContaining("987654321"),
    );
  });

  it("sends an error when getSeed returns null", async () => {
    const s = makeSrv(null);
    await run(nextUser(), s);
    expect(s.send).toHaveBeenCalledWith(
      expect.stringContaining("Could not retrieve"),
    );
  });
});

// ── !netherportal ─────────────────────────────────────────────────────────

describe("!netherportal handler", () => {
  let regex: RegExp, handler: Handler;

  beforeEach(async () => {
    const p = capture();
    (await import("../../src/bot/logWatcher/commands/info/netherportal.js")).init();
    ({ regex, handler } = await p);
  });

  function run(username: string, server: never) {
    const m = regex.exec(`[12:00:00] [INFO]: <${username}> !netherportal`)!;
    return handler(m, null as never, server);
  }
  function makeSrv(
    coords: { x: number; y: number; z: number } | null,
    dim: string | null,
  ) {
    return {
      getPlayerCoords: vi
        .fn()
        .mockResolvedValue(coords ? { ok: true, value: coords } : FAIL),
      getPlayerDimension: vi
        .fn()
        .mockResolvedValue(dim === null ? FAIL : { ok: true, value: dim }),
      send: vi.fn().mockResolvedValue(DELIVERED),
    } as never;
  }

  it("converts overworld coords to nether portal (÷8)", async () => {
    const s = makeSrv({ x: 800, y: 64, z: -400 }, "overworld");
    await run(nextUser(), s);
    expect(s.send).toHaveBeenCalledWith(
      expect.stringContaining("Nether coords: X: 100, Z: -50"),
    );
  });

  it("converts nether coords to overworld portal (×8)", async () => {
    const s = makeSrv({ x: 100, y: 64, z: -50 }, "the_nether");
    await run(nextUser(), s);
    expect(s.send).toHaveBeenCalledWith(
      expect.stringContaining("Overworld coords: X: 800, Z: -400"),
    );
  });

  it("sends an error when player is in the End", async () => {
    const s = makeSrv({ x: 0, y: 64, z: 0 }, "the_end");
    await run(nextUser(), s);
    expect(s.send).toHaveBeenCalledWith(
      expect.stringContaining("Overworld or Nether"),
    );
  });

  it("sends an error when getPlayerCoords returns null", async () => {
    const s = makeSrv(null, "overworld");
    await run(nextUser(), s);
    expect(s.send).toHaveBeenCalledWith(
      expect.stringContaining("Could not get your position"),
    );
  });

  it("says the server is unreachable when the position query is", async () => {
    const s = {
      getPlayerCoords: vi
        .fn()
        .mockResolvedValue({ ok: false, reason: "unreachable" }),
      getPlayerDimension: vi.fn(),
      send: vi.fn().mockResolvedValue(DELIVERED),
    } as never;
    await run(nextUser(), s);
    expect(s.send).toHaveBeenCalledWith(
      expect.stringContaining("Could not reach the server"),
    );
  });

  it("does not guess the dimension when it cannot be read", async () => {
    const s = makeSrv({ x: 800, y: 64, z: -400 }, null);
    await run(nextUser(), s);
    expect(s.send).toHaveBeenCalledWith(
      expect.stringContaining("which dimension"),
    );
  });
});
