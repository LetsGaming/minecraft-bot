/**
 * The one head URL every place uses: the daily version, the manual refresh
 * token, the store that holds it, and the live probe of mc-heads.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { closeDbForTesting } from "../../src/core/db/index.js";
import { kvSet } from "../../src/core/db/kv.js";
import { headVersion, playerHeadUrl, probeHead } from "../../src/core/utils/minecraft/playerHead.js";
import { headInfo, refreshHead } from "../../src/core/utils/stores/headStore.js";

const DAY = 86_400_000;
const NOON = Date.UTC(2026, 10, 21, 12, 0, 0);
const dayOf = (ms: number): string => Math.floor(ms / DAY).toString();

beforeEach(() => closeDbForTesting());
afterEach(() => {
  vi.unstubAllGlobals();
  closeDbForTesting();
});

describe("playerHeadUrl", () => {
  it("is the same URL for every caller on the same day", () => {
    expect(playerHeadUrl("Steve", NOON)).toBe(playerHeadUrl("Steve", NOON + 5 * 3_600_000));
    expect(playerHeadUrl("Steve", NOON)).toBe(`https://mc-heads.net/avatar/Steve/64?v=${dayOf(NOON)}`);
  });

  it("changes on the next UTC day, so a bad cached image heals by itself", () => {
    expect(playerHeadUrl("Steve", NOON + DAY)).not.toBe(playerHeadUrl("Steve", NOON));
    const justBefore = Date.UTC(2026, 10, 21, 23, 59, 59);
    const justAfter = Date.UTC(2026, 10, 22, 0, 0, 0);
    expect(playerHeadUrl("Steve", justBefore)).not.toBe(playerHeadUrl("Steve", justAfter));
  });

  it("changes after a manual refresh and again after the next one", () => {
    const before = playerHeadUrl("Steve", NOON);
    refreshHead("Steve", "u1", NOON);
    const first = playerHeadUrl("Steve", NOON);
    refreshHead("Steve", "u1", NOON);
    const second = playerHeadUrl("Steve", NOON);
    expect(new Set([before, first, second]).size).toBe(3);
    expect(first).toContain(`v=${dayOf(NOON)}.`);
  });

  it("finds a refresh whatever the casing of the name", () => {
    refreshHead("Steve", "u1", NOON);
    expect(headVersion("STEVE", NOON)).toBe(headVersion("steve", NOON));
    expect(headVersion("steve", NOON)).toContain(".");
  });

  it("leaves other players alone", () => {
    refreshHead("Steve", "u1", NOON);
    expect(headVersion("Alex", NOON)).toBe(dayOf(NOON));
  });

  it("encodes the name", () => {
    expect(playerHeadUrl("a b/c", NOON)).toContain("/avatar/a%20b%2Fc/64");
  });

  it("falls back to the daily version when the store cannot be read", () => {
    refreshHead("Steve", "u1", NOON);
    expect(playerHeadUrl("Steve", NOON)).toContain(`v=${dayOf(NOON)}.`);
    closeDbForTesting();
    const previous = process.env.MCBOT_DB_PATH;
    process.env.MCBOT_DB_PATH = "/nonexistent-dir-for-test/head.db";
    try {
      expect(playerHeadUrl("Steve", NOON)).toBe(`https://mc-heads.net/avatar/Steve/64?v=${dayOf(NOON)}`);
    } finally {
      process.env.MCBOT_DB_PATH = previous;
      closeDbForTesting();
    }
  });
});

describe("headStore", () => {
  it("returns null for a player nobody refreshed", () => {
    expect(headInfo("Steve")).toBeNull();
  });

  it("records who refreshed and when", () => {
    const entry = refreshHead("Steve", "123", NOON);
    expect(entry).toMatchObject({ refreshedAt: NOON, by: "123" });
    expect(headInfo("steve")).toEqual(entry);
  });

  it("gives two refreshes in the same millisecond different tokens", () => {
    expect(refreshHead("Steve", "u1", NOON).bump).not.toBe(refreshHead("Steve", "u1", NOON).bump);
  });

  it("stores a name such as __proto__ without touching Object.prototype", () => {
    refreshHead("__proto__", "u1", NOON);
    expect(headInfo("__proto__")?.by).toBe("u1");
    expect(headInfo("Alex")).toBeNull();
    expect(({} as { bump?: string }).bump).toBeUndefined();
  });

  it("ignores a malformed stored entry and keeps the good one", () => {
    kvSet("playerHeads", {
      players: { bad: 1, worse: { bump: 5 }, good: { bump: "x", refreshedAt: 1, by: "u" } },
    });
    expect(headInfo("bad")).toBeNull();
    expect(headInfo("worse")).toBeNull();
    expect(headInfo("good")?.bump).toBe("x");
  });

  it("copes with a stored value that is not a document", () => {
    kvSet("playerHeads", "nonsense");
    expect(headInfo("Steve")).toBeNull();
    expect(refreshHead("Steve", "u", NOON).by).toBe("u");
  });
});

describe("probeHead", () => {
  function reply(init: { status?: number; headers?: Record<string, string>; body?: number }): Response {
    return new Response(new Uint8Array(init.body ?? 337), {
      status: init.status ?? 200,
      headers: { "content-type": "image/png", ...init.headers },
    });
  }

  it("reports the CDN age, cache status and size of a good image", async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply({ headers: { age: "6087", "cf-cache-status": "HIT" } }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await probeHead("Steve", NOON)).toEqual({
      ok: true,
      status: 200,
      bytes: 337,
      ageSeconds: 6087,
      cache: "HIT",
    });
    expect(fetchMock.mock.calls[0]![0]).toBe(playerHeadUrl("Steve", NOON));
  });

  it("has no age when the CDN sends none", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply({})));
    expect((await probeHead("Steve", NOON)).ageSeconds).toBeNull();
  });

  it("is not ok for an error status, a non-image or an oversized body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply({ status: 404 })));
    expect((await probeHead("Steve", NOON)).ok).toBe(false);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply({ headers: { "content-type": "text/html" } })));
    expect((await probeHead("Steve", NOON)).ok).toBe(false);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply({ body: 70 * 1024 })));
    expect((await probeHead("Steve", NOON)).ok).toBe(false);
  });

  it("is not ok when the request fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    expect(await probeHead("Steve", NOON)).toEqual({
      ok: false,
      status: null,
      bytes: null,
      ageSeconds: null,
      cache: null,
    });
  });
});
