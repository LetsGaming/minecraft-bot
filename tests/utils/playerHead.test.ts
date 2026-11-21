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
import {
  getSkin,
  headInfo,
  markSkinFailed,
  pruneSkins,
  refreshHead,
  setSkin,
} from "../../src/core/utils/stores/headStore.js";

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

describe("playerHeadUrl with a stored skin hash", () => {
  const HASH = "c".repeat(64);

  it("names the skin by its hash instead of the player", () => {
    setSkin("Steve", HASH, NOON);
    expect(playerHeadUrl("Steve", NOON)).toBe(`https://mc-heads.net/avatar/${HASH}/64?v=${dayOf(NOON)}`);
    expect(playerHeadUrl("STEVE", NOON)).toBe(playerHeadUrl("Steve", NOON));
  });

  it("changes with the skin, so a new skin is a new image", () => {
    setSkin("Steve", HASH, NOON);
    const first = playerHeadUrl("Steve", NOON);
    setSkin("Steve", "d".repeat(64), NOON);
    expect(playerHeadUrl("Steve", NOON)).not.toBe(first);
  });

  it("falls back to the name for a default skin, an unchecked player or a failed check", () => {
    const byName = `https://mc-heads.net/avatar/Steve/64?v=${dayOf(NOON)}`;
    expect(playerHeadUrl("Steve", NOON)).toBe(byName);
    setSkin("Steve", null, NOON);
    expect(playerHeadUrl("Steve", NOON)).toBe(byName);
    markSkinFailed("Steve", NOON);
    expect(playerHeadUrl("Steve", NOON)).toBe(byName);
  });

  it("keeps the manual refresh token in the version of a hash URL", () => {
    setSkin("Steve", HASH, NOON);
    refreshHead("Steve", "u1", NOON);
    expect(playerHeadUrl("Steve", NOON)).toMatch(new RegExp(`/avatar/${HASH}/64\\?v=${dayOf(NOON)}\\.`));
  });

  it("keeps the refresh token across a new skin check", () => {
    setSkin("Steve", HASH, NOON);
    refreshHead("Steve", "u1", NOON);
    setSkin("Steve", HASH, NOON + 1);
    expect(headVersion("Steve", NOON)).toContain(".");
  });
});

describe("skin entries in the store", () => {
  it("keeps the old hash when a check fails, and clears the failure on the next answer", () => {
    setSkin("Steve", "e".repeat(64), NOON);
    markSkinFailed("Steve", NOON + 5);
    expect(getSkin("steve")).toEqual({ hash: "e".repeat(64), checkedAt: NOON, failedAt: NOON + 5 });
    setSkin("Steve", "e".repeat(64), NOON + 10);
    expect(getSkin("Steve")).toEqual({ hash: "e".repeat(64), checkedAt: NOON + 10 });
  });

  it("notes a failure for a player never checked, without inventing a hash", () => {
    markSkinFailed("Steve", NOON);
    expect(getSkin("Steve")).toEqual({ hash: null, checkedAt: 0, failedAt: NOON });
  });

  it("prunes players that are no longer kept, ignoring case", () => {
    setSkin("Steve", null, NOON);
    setSkin("Alex", null, NOON);
    setSkin("Gone", null, NOON);
    expect(pruneSkins(["steve", "ALEX"])).toBe(1);
    expect(getSkin("Gone")).toBeNull();
    expect(getSkin("Steve")).not.toBeNull();
    expect(getSkin("Alex")).not.toBeNull();
  });

  it("stores a __proto__ name without touching Object.prototype, and drops malformed skin entries", () => {
    setSkin("__proto__", "f".repeat(64), NOON);
    expect(getSkin("__proto__")?.hash).toBe("f".repeat(64));
    expect(({} as { hash?: string }).hash).toBeUndefined();
    kvSet("playerHeads", {
      players: {},
      skins: { bad: { hash: 5, checkedAt: 1 }, worse: "x", good: { hash: null, checkedAt: 2 } },
    });
    expect(getSkin("bad")).toBeNull();
    expect(getSkin("worse")).toBeNull();
    expect(getSkin("good")).toEqual({ hash: null, checkedAt: 2 });
  });

  it("still reads a document written before skin entries existed", () => {
    kvSet("playerHeads", { players: { steve: { bump: "x", refreshedAt: 1, by: "u" } } });
    expect(headInfo("Steve")?.bump).toBe("x");
    expect(getSkin("Steve")).toBeNull();
  });
});
