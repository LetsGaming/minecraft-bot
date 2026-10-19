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
  readRewardsDocument,
  writeRewardsDocument,
  loadDailyRewardsConfig,
  loadServerRewardsOverride,
  formatRewardsDocument,
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
    const before = await readRewardsDocument({ kind: "shared" });
    const hash = await writeRewardsDocument({ kind: "shared" }, { default: [{ item: "diamond", amount: 2, weight: 1 }] }, before.hash);
    expect(hash).not.toBe(before.hash);
    expect((await readRewardsDocument({ kind: "shared" })).pool.default).toEqual([{ item: "diamond", amount: 2, weight: 1 }]);

    await expect(
      writeRewardsDocument({ kind: "shared" }, { default: [{ item: "stone", amount: 1 }] }, before.hash),
    ).rejects.toMatchObject({ kind: "conflict" });
  });

  it("refuses an invalid document and writes nothing", async () => {
    const before = await readRewardsDocument({ kind: "shared" });
    const err = await writeRewardsDocument({ kind: "shared" }, { default: [{ item: "Not An Id" }] }, before.hash).catch((e) => e);
    expect(err).toBeInstanceOf(RewardsWriteError);
    expect(err.kind).toBe("invalid");
    expect((await readRewardsDocument({ kind: "shared" })).hash).toBe(before.hash);
  });

  it("creates an override, and removes it once it overrides nothing", async () => {
    const scope = { kind: "server" as const, serverId: "smp" };
    const absent = await readRewardsDocument(scope);
    expect(absent).toMatchObject({ exists: false, hash: "absent" });

    const hash = await writeRewardsDocument(scope, { bonusChance: 10 }, absent.hash);
    expect(await loadServerRewardsOverride("smp")).toEqual({ bonusChance: 10 });

    await writeRewardsDocument(scope, {}, hash);
    expect(existsSync(path.join(dir, "dailyRewards_smp.json"))).toBe(false);
    expect(existsSync(path.join(dir, "dailyRewards_smp.json.bak"))).toBe(false);
    expect(await loadServerRewardsOverride("smp")).toBeUndefined();
  });

  it("keeps one reward per line and the days in order", async () => {
    const scope = { kind: "server" as const, serverId: "smp" };
    await writeRewardsDocument(
      scope,
      { streakBonuses: { "14": [{ item: "b", amount: 1 }], "3": [{ item: "a", amount: 1 }] }, default: [{ item: "c", amount: 1 }] },
      "absent",
    );
    const text = readFileSync(path.join(dir, "dailyRewards_smp.json"), "utf-8");
    expect(text).toBe(
      formatRewardsDocument({
        default: [{ item: "c", amount: 1 }],
        streakBonuses: { "3": [{ item: "a", amount: 1 }], "14": [{ item: "b", amount: 1 }] },
      }),
    );
    expect(text).toContain('    {"item":"c","amount":1}');
    expect(text.indexOf('"3"')).toBeLessThan(text.indexOf('"14"'));
    expect(JSON.parse(text)).toBeTruthy();
  });
});
