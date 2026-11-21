/**
 * The skin resolver against a faked Mojang and mc-heads: what it stores, when
 * it asks, what it does when Mojang says no, and how a sweep paces itself.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { closeDbForTesting } from "../../src/core/db/index.js";
import { log } from "../../src/core/utils/logger.js";
import { getSkin, markSkinFailed, setSkin } from "../../src/core/utils/stores/headStore.js";
import { playerHeadUrl } from "../../src/core/utils/minecraft/playerHead.js";
import {
  _resetSkinResolverForTesting,
  ensureFreshSkin,
  refreshSkins,
  resolveSkin,
  skinIsFresh,
} from "../../src/core/utils/minecraft/skinResolver.js";

const NOW = Date.UTC(2026, 10, 21, 12, 0, 0);
const MIN = 60_000;
const HOUR = 60 * MIN;
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const DEFAULT_IMAGE = Uint8Array.from([1, 2, 3, 4]);
const REAL_IMAGE = Uint8Array.from([9, 8, 7]);

interface Account {
  uuid: string;
  hash: string | null;
}

const world = {
  accounts: new Map<string, Account>(),
  nameStatus: new Map<string, number>(),
  sessionStatus: new Map<string, number>(),
  mcHeadsAnswersDefaultForHashes: false,
  mcHeadsDown: false,
  hang: false,
  calls: [] as Array<{ url: string; at: number }>,
};

function profileBody(hash: string | null): unknown {
  const textures = hash ? { SKIN: { url: `http://textures.minecraft.net/texture/${hash}` } } : {};
  return {
    id: "x",
    name: "x",
    properties: [{ name: "textures", value: Buffer.from(JSON.stringify({ textures })).toString("base64") }],
  };
}

const json = (body: unknown): Response =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

async function route(url: string): Promise<Response> {
  world.calls.push({ url, at: Date.now() });
  if (world.hang) return new Promise<Response>(() => undefined);
  if (url.startsWith("https://api.mojang.com/users/profiles/minecraft/")) {
    const name = decodeURIComponent(url.split("/").pop()!).toLowerCase();
    const status = world.nameStatus.get(name);
    if (status) return new Response("", { status });
    const account = world.accounts.get(name);
    if (!account) return new Response("", { status: 404 });
    return json({ id: account.uuid, name });
  }
  if (url.startsWith("https://sessionserver.mojang.com/session/minecraft/profile/")) {
    const uuid = url.split("/").pop()!;
    const status = world.sessionStatus.get(uuid);
    if (status) return new Response("", { status });
    const account = [...world.accounts.values()].find((a) => a.uuid === uuid)!;
    return json(profileBody(account.hash));
  }
  if (url.startsWith("https://mc-heads.net/avatar/")) {
    if (world.mcHeadsDown) throw new Error("mc-heads down");
    const key = url.split("/")[4]!;
    const isDefault = key === "zzqx_no_such_acct_91" || world.mcHeadsAnswersDefaultForHashes;
    return new Response(isDefault ? DEFAULT_IMAGE : REAL_IMAGE, { headers: { "content-type": "image/png" } });
  }
  throw new Error(`unexpected request ${url}`);
}

const count = (prefix: string): number => world.calls.filter((c) => c.url.startsWith(prefix)).length;
const NAME_API = "https://api.mojang.com/";
const SESSION_API = "https://sessionserver.mojang.com/";

function account(name: string, hash: string | null, uuid = `uuid-${name.toLowerCase()}`): void {
  world.accounts.set(name.toLowerCase(), { uuid, hash });
}

beforeEach(() => {
  closeDbForTesting();
  _resetSkinResolverForTesting();
  vi.clearAllMocks();
  world.accounts.clear();
  world.nameStatus.clear();
  world.sessionStatus.clear();
  world.mcHeadsAnswersDefaultForHashes = false;
  world.mcHeadsDown = false;
  world.hang = false;
  world.calls = [];
  vi.stubGlobal("fetch", vi.fn((url: unknown) => route(String(url))));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  _resetSkinResolverForTesting();
  closeDbForTesting();
});

describe("resolveSkin", () => {
  it("stores a new hash, and the head URL follows it", async () => {
    account("Steve", HASH_B);
    expect(await resolveSkin("Steve", { now: NOW })).toEqual({ kind: "changed", hash: HASH_B, previous: null });
    expect(getSkin("steve")).toEqual({ hash: HASH_B, checkedAt: NOW });
    const day = Math.floor(NOW / 86_400_000);
    expect(playerHeadUrl("Steve", NOW)).toBe(`https://mc-heads.net/avatar/${HASH_B}/64?v=${day}`);
  });

  it("reports a different hash as changed and keeps what it replaced", async () => {
    setSkin("Steve", HASH_A, NOW - 2 * HOUR);
    account("Steve", HASH_B);
    expect(await resolveSkin("Steve", { now: NOW })).toEqual({ kind: "changed", hash: HASH_B, previous: HASH_A });
  });

  it("reports the same hash as unchanged, refreshes the check time and does not verify it again", async () => {
    account("Steve", HASH_B);
    await resolveSkin("Steve", { now: NOW });
    expect(await resolveSkin("Steve", { now: NOW + HOUR })).toEqual({ kind: "unchanged", hash: HASH_B });
    expect(getSkin("Steve")?.checkedAt).toBe(NOW + HOUR);
    expect(world.calls.filter((c) => c.url.includes(HASH_B))).toHaveLength(1);
    expect(world.calls.filter((c) => c.url.includes("zzqx_no_such_acct_91"))).toHaveLength(1);
  });

  it("stores a null hash for a default skin, without checking mc-heads", async () => {
    setSkin("Steve", HASH_A, NOW - 2 * HOUR);
    account("Steve", null);
    expect(await resolveSkin("Steve", { now: NOW })).toEqual({ kind: "changed", hash: null, previous: HASH_A });
    expect(getSkin("Steve")).toEqual({ hash: null, checkedAt: NOW });
    expect(count("https://mc-heads.net/")).toBe(0);
  });

  it("says unknown-account for a name Mojang does not know, and asks nothing further", async () => {
    expect(await resolveSkin("Ghost", { now: NOW })).toEqual({ kind: "unknown-account" });
    expect(getSkin("Ghost")).toEqual({ hash: null, checkedAt: NOW });
    expect(count(SESSION_API)).toBe(0);
  });

  it("keeps the stored hash and notes the failure when Mojang rate-limits the name lookup", async () => {
    setSkin("Steve", HASH_A, NOW - 2 * HOUR);
    account("Steve", HASH_B);
    world.nameStatus.set("steve", 429);
    expect(await resolveSkin("Steve", { now: NOW })).toEqual({ kind: "unavailable", rateLimited: true });
    expect(getSkin("Steve")).toEqual({ hash: HASH_A, checkedAt: NOW - 2 * HOUR, failedAt: NOW });
  });

  it("keeps the stored hash when the session server fails", async () => {
    setSkin("Steve", HASH_A, NOW - 2 * HOUR);
    account("Steve", HASH_B, "uuid-steve");
    world.sessionStatus.set("uuid-steve", 500);
    expect(await resolveSkin("Steve", { now: NOW })).toEqual({ kind: "unavailable", rateLimited: false });
    expect(getSkin("Steve")?.hash).toBe(HASH_A);
  });

  it("does not store a hash that mc-heads answers with its default head, and warns once", async () => {
    setSkin("Steve", HASH_A, NOW - 2 * HOUR);
    account("Steve", HASH_B);
    account("Alex", HASH_B);
    world.mcHeadsAnswersDefaultForHashes = true;
    expect(await resolveSkin("Steve", { now: NOW })).toEqual({ kind: "rejected", hash: HASH_B });
    expect(getSkin("Steve")?.hash).toBe(HASH_A);
    expect(getSkin("Steve")?.failedAt).toBe(NOW);
    await resolveSkin("Alex", { now: NOW });
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(vi.mocked(log.warn).mock.calls[0]![1]).toContain(HASH_B);
  });

  it("trusts Mojang when mc-heads cannot be checked", async () => {
    account("Steve", HASH_B);
    world.mcHeadsDown = true;
    expect((await resolveSkin("Steve", { now: NOW })).kind).toBe("changed");
    expect(getSkin("Steve")?.hash).toBe(HASH_B);
  });

  it("shares one lookup between concurrent calls for the same player", async () => {
    account("Steve", HASH_B);
    const [a, b] = await Promise.all([resolveSkin("Steve", { now: NOW }), resolveSkin("steve", { now: NOW })]);
    expect(a).toEqual(b);
    expect(count(NAME_API)).toBe(1);
  });

  it("answers unavailable and stores the failure when something throws inside", async () => {
    account("Steve", HASH_B);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("boom")));
    expect(await resolveSkin("Steve", { now: NOW })).toEqual({ kind: "unavailable", rateLimited: false });
    expect(getSkin("Steve")?.failedAt).toBe(NOW);
  });
});

describe("ensureFreshSkin and skinIsFresh", () => {
  const options = { maxAgeMs: HOUR, timeoutMs: 3_000, now: NOW };

  it("does nothing for a recent check", async () => {
    setSkin("Steve", HASH_A, NOW - 10 * MIN);
    expect(skinIsFresh("Steve", HOUR, NOW)).toBe(true);
    expect(await ensureFreshSkin("Steve", options)).toEqual({ kind: "skipped" });
    expect(world.calls).toHaveLength(0);
  });

  it("asks Mojang for an old check, or none at all", async () => {
    account("Steve", HASH_B);
    expect(skinIsFresh("Steve", HOUR, NOW)).toBe(false);
    setSkin("Steve", HASH_A, NOW - 2 * HOUR);
    expect(skinIsFresh("Steve", HOUR, NOW)).toBe(false);
    expect((await ensureFreshSkin("Steve", options)).kind).toBe("changed");
  });

  it("leaves a player alone for six hours after a failure, then asks again", async () => {
    account("Steve", HASH_B);
    markSkinFailed("Steve", NOW - HOUR);
    expect(skinIsFresh("Steve", HOUR, NOW)).toBe(true);
    expect(await ensureFreshSkin("Steve", options)).toEqual({ kind: "skipped" });
    expect((await ensureFreshSkin("Steve", { ...options, now: NOW + 6 * HOUR })).kind).toBe("changed");
  });

  it("resolveSkin itself ignores freshness", async () => {
    setSkin("Steve", HASH_A, NOW - MIN);
    account("Steve", HASH_B);
    expect((await resolveSkin("Steve", { now: NOW })).kind).toBe("changed");
  });

  it("gives up waiting after the time limit while the lookup carries on", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    world.hang = true;
    const pending = ensureFreshSkin("Steve", options);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(await pending).toEqual({ kind: "pending" });
  });
});

describe("refreshSkins", () => {
  const sweep = { maxAgeMs: HOUR, spacingMs: 1_500 };

  it("asks one player at a time, spaced out", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    for (const n of ["Alpha", "Bravo", "Charlie"]) account(n, HASH_B);
    const run = refreshSkins(["Alpha", "Bravo", "Charlie"], sweep);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await run).toEqual({ asked: 3, changed: 3, failed: 0, skipped: 0, stoppedEarly: false });
    const starts = world.calls.filter((c) => c.url.startsWith(NAME_API)).map((c) => c.at);
    expect(starts[1]! - starts[0]!).toBeGreaterThanOrEqual(1_500);
    expect(starts[2]! - starts[1]!).toBeGreaterThanOrEqual(1_500);
  });

  it("skips a player checked recently without waiting", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    for (const n of ["Alpha", "Bravo"]) account(n, HASH_B);
    setSkin("Bravo", HASH_B, NOW - MIN);
    const run = refreshSkins(["Alpha", "Bravo"], sweep);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await run).toEqual({ asked: 1, changed: 1, failed: 0, skipped: 1, stoppedEarly: false });
  });

  it("stops at the first rate-limit answer and leaves the rest for the next sweep", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    for (const n of ["Alpha", "Bravo", "Charlie"]) account(n, HASH_B);
    world.nameStatus.set("bravo", 429);
    const run = refreshSkins(["Alpha", "Bravo", "Charlie"], sweep);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await run).toEqual({ asked: 2, changed: 1, failed: 1, skipped: 0, stoppedEarly: true });
    expect(getSkin("Charlie")).toBeNull();
  });

  it("counts a failure that is not a rate limit and carries on", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    for (const n of ["Alpha", "Bravo"]) account(n, HASH_B);
    world.nameStatus.set("alpha", 500);
    const run = refreshSkins(["Alpha", "Bravo"], sweep);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await run).toEqual({ asked: 2, changed: 1, failed: 1, skipped: 0, stoppedEarly: false });
  });
});
