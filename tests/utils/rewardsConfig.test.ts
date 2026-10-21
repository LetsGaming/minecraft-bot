/**
 * The reward documents on disk: seeding the shared pool from the shipped
 * defaults, the hash-guarded write, and removing an override that no longer
 * overrides anything. Real files in a temp dir; the shipped defaults are the
 * repo's own (read only).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import {
  readSharedDocument,
  readServerDocument,
  writeRewardsDocument,
  loadDailyRewardsConfig,
  loadServerRewardsOverride,
  formatOverrideDocument,
  RewardsWriteError,
} from "../../src/core/utils/stores/rewardsConfig.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "mcbot-rewards-"));
  process.env.MCBOT_REWARDS_DIR = dir;
});

afterEach(() => {
  delete process.env.MCBOT_REWARDS_DIR;
  rmSync(dir, { recursive: true, force: true });
});

describe("the shared pool", () => {
  it("is created from the shipped defaults on first use", async () => {
    const cfg = await loadDailyRewardsConfig();
    expect(existsSync(path.join(dir, "dailyRewards.json"))).toBe(true);
    expect(cfg.default.length).toBeGreaterThan(10);
  });

  it("is never re-seeded over an existing file", async () => {
    writeFileSync(path.join(dir, "dailyRewards.json"), JSON.stringify({ default: [{ item: "dirt" }] }));
    const cfg = await loadDailyRewardsConfig();
    expect(cfg.default).toEqual([{ item: "dirt", amount: 1 }]);
  });
});

describe("writeRewardsDocument", () => {
  it("writes when the hash matches and refuses a stale one", async () => {
    const before = await readSharedDocument();
    const hash = await writeRewardsDocument({ kind: "shared" }, { default: [{ item: "diamond", amount: 2, weight: 1 }] }, before.hash);
    expect(hash).not.toBe(before.hash);
    expect((await readSharedDocument()).pool.default).toMatchObject([{ item: "diamond", amount: 2, weight: 1 }]);

    await expect(
      writeRewardsDocument({ kind: "shared" }, { default: [{ item: "stone", amount: 1 }] }, before.hash),
    ).rejects.toMatchObject({ kind: "conflict" });
  });

  it("refuses an invalid document and writes nothing", async () => {
    const before = await readSharedDocument();
    const err = await writeRewardsDocument({ kind: "shared" }, { default: [{ item: "Not An Id" }] }, before.hash).catch((e) => e);
    expect(err).toBeInstanceOf(RewardsWriteError);
    expect(err.kind).toBe("invalid");
    expect((await readSharedDocument()).hash).toBe(before.hash);
  });

  it("creates an override, and removes it once it overrides nothing", async () => {
    const scope = { kind: "server" as const, serverId: "smp" };
    const absent = await readServerDocument("smp");
    expect(absent).toMatchObject({ exists: false, hash: "absent" });

    const hash = await writeRewardsDocument(scope, { bonusChance: 10 }, absent.hash);
    expect(await loadServerRewardsOverride("smp")).toEqual({ bonusChance: 10 });

    await writeRewardsDocument(scope, {}, hash);
    expect(existsSync(path.join(dir, "dailyRewards_smp.json"))).toBe(false);
    expect(existsSync(path.join(dir, "dailyRewards_smp.json.bak"))).toBe(false);
    expect(await loadServerRewardsOverride("smp")).toBeUndefined();
  });

  it("keeps one entry per line and the days in order", async () => {
    const scope = { kind: "server" as const, serverId: "smp" };
    const doc = {
      default: { add: [{ id: "c1", item: "c", amount: 1 }] },
      streakBonuses: { days: { "14": { add: [{ id: "b1", item: "b", amount: 1 }] }, "3": { add: [{ id: "a1", item: "a", amount: 1 }] } } },
    };
    await writeRewardsDocument(scope, doc, "absent");
    const text = readFileSync(path.join(dir, "dailyRewards_smp.json"), "utf-8");
    expect(text).toBe(formatOverrideDocument((await readServerDocument("smp")).pool));
    expect(text).toContain('      {"item":"c","amount":1,"id":"c1"}');
    expect(text.indexOf('"3"')).toBeLessThan(text.indexOf('"14"'));
    expect(JSON.parse(text)).toBeTruthy();
  });

  it("saves the shared pool with an id on every entry", async () => {
    const before = await readSharedDocument();
    await writeRewardsDocument(
      { kind: "shared" },
      { default: [{ item: "diamond", amount: 1 }, { item: "diamond", amount: 64 }], streakBonuses: { "3": [{ item: "bread", amount: 2 }] } },
      before.hash,
    );
    const { pool } = await readSharedDocument();
    const ids = pool.default!.map((e) => e.id);
    expect(ids.every((id) => typeof id === "string")).toBe(true);
    expect(new Set(ids).size).toBe(2);
    expect(pool.streakBonuses!["3"]![0]!.id).toBeTruthy();
  });

  it("refuses an override that would leave the server without items", async () => {
    const shared = await readSharedDocument();
    const everyId = shared.pool.default!.map((e) => e.id ?? "");
    const err = await writeRewardsDocument({ kind: "server", serverId: "smp" }, { default: { remove: everyId } }, "absent").catch((e) => e);
    expect(err).toBeInstanceOf(RewardsWriteError);
    expect(err.kind).toBe("invalid");
    expect(existsSync(path.join(dir, "dailyRewards_smp.json"))).toBe(false);
  });

  it("reads an override still in the old format as exceptions", async () => {
    writeFileSync(path.join(dir, "dailyRewards.json"), JSON.stringify({ default: [{ item: "stone", amount: 1, weight: 5 }, { item: "dirt", amount: 1 }] }));
    writeFileSync(path.join(dir, "dailyRewards_smp.json"), JSON.stringify({ default: [{ item: "stone", amount: 1, weight: 5 }, { item: "glass", amount: 4 }] }));
    const override = await loadServerRewardsOverride("smp");
    expect(override?.default?.remove).toHaveLength(1);
    expect(override?.default?.add).toMatchObject([{ item: "glass", amount: 4 }]);
  });
});
