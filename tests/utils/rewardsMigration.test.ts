/**
 * The upgrade of reward files to entry ids and exceptions, on real files in a
 * temp dir. The point of every case is the same: what a server resolves to
 * before and after must be identical, and the original bytes must survive.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync, existsSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { parseOverridePool, parseRewardPool, type RewardPool } from "@mcbot/schema/dailyRewards.js";
import { legacyResolve, resolvePool, samePool } from "@mcbot/schema/rewardPatch.js";
import { migrateRewardFiles, REWARDS_BACKUP_SUFFIX } from "../../src/core/rewardsMigration.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "mcbot-rewards-migration-"));
  process.env.MCBOT_REWARDS_DIR = dir;
});

afterEach(() => {
  delete process.env.MCBOT_REWARDS_DIR;
  rmSync(dir, { recursive: true, force: true });
});

const SHARED = {
  default: [
    { item: "minecraft:dirt", amount: 16, weight: 20 },
    { item: "minecraft:diamond", amount: 1, weight: 10 },
    { item: "minecraft:diamond", amount: 64, weight: 1 },
    { item: "minecraft:netherite_ingot", amount: 64, weight: 0.01 },
  ],
  streakBonuses: {
    "3": [{ item: "minecraft:bread", amount: 8 }],
    "14": [{ item: "minecraft:golden_apple", amount: 2 }, { item: "minecraft:emerald", amount: 5 }],
  },
  bonusChance: 5,
};

const file = (name: string): string => path.join(dir, name);
const write = (name: string, value: unknown): string => {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  writeFileSync(file(name), text);
  return text;
};
const read = (name: string): string => readFileSync(file(name), "utf-8");
const sharedPool = (): RewardPool => parseRewardPool(JSON.parse(read("dailyRewards.json")), "shared").pool;
const results = (report: Awaited<ReturnType<typeof migrateRewardFiles>>): Record<string, string> =>
  Object.fromEntries(report.files.map((f) => [f.file, f.action]));

describe("shared pool", () => {
  it("gets an id on every entry, keeps its rewards, and is left alone on a rerun", async () => {
    const original = write("dailyRewards.json", SHARED);
    const before = parseRewardPool(SHARED, "shared").pool;

    const report = await migrateRewardFiles();
    expect(results(report)).toEqual({ "dailyRewards.json": "migrated" });

    const after = sharedPool();
    expect(samePool(after, before)).toBe(true);
    const ids = after.default!.map((e) => e.id);
    expect(ids.every(Boolean)).toBe(true);
    expect(new Set(ids).size).toBe(4);
    expect(read(`dailyRewards.json${REWARDS_BACKUP_SUFFIX}`)).toBe(original);

    const snapshot = read("dailyRewards.json");
    expect(results(await migrateRewardFiles())).toEqual({ "dailyRewards.json": "unchanged" });
    expect(read("dailyRewards.json")).toBe(snapshot);
  });

  it("migrates the shipped defaults without changing a single reward", async () => {
    const shipped = readFileSync(path.join(__dirname, "..", "..", "data", "dailyRewards.defaults.json"), "utf-8");
    write("dailyRewards.json", shipped);
    await migrateRewardFiles();
    expect(samePool(sharedPool(), parseRewardPool(JSON.parse(shipped), "shared").pool)).toBe(true);
  });

  it("does not touch a file that has problems of its own", async () => {
    const original = write("dailyRewards.json", { default: [{ item: "dirt", amount: 1 }, { item: "Not An Id" }] });
    const report = await migrateRewardFiles();
    expect(results(report)["dailyRewards.json"]).toBe("skipped");
    expect(read("dailyRewards.json")).toBe(original);
  });
});

describe("overrides", () => {
  async function migrateWith(legacy: unknown): Promise<{ name: string; expected: RewardPool }> {
    write("dailyRewards.json", SHARED);
    write("dailyRewards_smp.json", legacy);
    const shared = parseRewardPool(SHARED, "shared").pool;
    const expected = legacyResolve(shared, parseRewardPool(legacy, "override").pool);
    await migrateRewardFiles();
    return { name: "dailyRewards_smp.json", expected };
  }

  function resolvedOnDisk(name: string): RewardPool {
    const parsed = parseOverridePool(JSON.parse(read(name)));
    expect(parsed.errors).toEqual([]);
    return resolvePool(sharedPool(), parsed.pool).pool;
  }

  it("rewrites extra and missing entries as exceptions that resolve to the same pool", async () => {
    const legacy = {
      default: [
        { item: "minecraft:dirt", amount: 16, weight: 20 },
        { item: "minecraft:diamond", amount: 1, weight: 30 },
        { item: "minecraft:diamond", amount: 64, weight: 1 },
        { item: "minecraft:apple", amount: 4, weight: 2 },
      ],
      bonusChance: 9,
    };
    const { name, expected } = await migrateWith(legacy);
    expect(samePool(resolvedOnDisk(name), expected)).toBe(true);
    expect(JSON.parse(read(name)).default.remove).toHaveLength(1);
    expect(JSON.parse(read(name)).default.add).toHaveLength(1);
    expect(read(name + REWARDS_BACKUP_SUFFIX)).toContain('"minecraft:apple"');
  });

  it("keeps duplicate entries with different amounts and weights apart", async () => {
    const legacy = {
      default: [
        { item: "minecraft:diamond", amount: 1, weight: 10 },
        { item: "minecraft:diamond", amount: 64, weight: 7 },
        { item: "minecraft:diamond", amount: 8, weight: 3 },
      ],
    };
    const { name, expected } = await migrateWith(legacy);
    expect(samePool(resolvedOnDisk(name), expected)).toBe(true);
  });

  it("converts streak days that changed, disappeared and appeared", async () => {
    const legacy = {
      streakBonuses: {
        "14": [{ item: "minecraft:golden_apple", amount: 2 }, { item: "minecraft:diamond", amount: 1 }],
        "30": [{ item: "minecraft:cake", amount: 1 }],
      },
    };
    const { name, expected } = await migrateWith(legacy);
    expect(samePool(resolvedOnDisk(name), expected)).toBe(true);
    const out = JSON.parse(read(name));
    expect(out.streakBonuses.removeDays).toEqual(["3"]);
    expect(Object.keys(out.streakBonuses.days)).toEqual(["14", "30"]);
  });

  it("turns an exact copy of the shared pool into inheriting it, and says so", async () => {
    write("dailyRewards.json", SHARED);
    write("dailyRewards_smp.json", SHARED);
    const report = await migrateRewardFiles();
    expect(existsSync(file("dailyRewards_smp.json"))).toBe(false);
    expect(report.files.find((f) => f.file === "dailyRewards_smp.json")).toMatchObject({ action: "removed", followsShared: true });
    expect(existsSync(file("dailyRewards_smp.json" + REWARDS_BACKUP_SUFFIX))).toBe(true);
  });

  it("leaves a file in the new form alone", async () => {
    write("dailyRewards.json", SHARED);
    const patch = write("dailyRewards_smp.json", { bonusChance: 3 });
    const report = await migrateRewardFiles();
    expect(results(report)["dailyRewards_smp.json"]).toBe("unchanged");
    expect(read("dailyRewards_smp.json")).toBe(patch);
  });

  it("does not rewrite an override whose entries would be dropped", async () => {
    write("dailyRewards.json", SHARED);
    const original = write("dailyRewards_smp.json", { default: [{ item: "minecraft:dirt", amount: 1 }, { item: "Bad Id" }] });
    const report = await migrateRewardFiles();
    expect(results(report)["dailyRewards_smp.json"]).toBe("skipped");
    expect(read("dailyRewards_smp.json")).toBe(original);
  });

  it("never replaces the first backup on a later run", async () => {
    write("dailyRewards.json", SHARED);
    const first = write("dailyRewards_smp.json", { default: [{ item: "minecraft:apple", amount: 1 }, ...SHARED.default] });
    await migrateRewardFiles();
    write("dailyRewards_smp.json", { default: [{ item: "minecraft:cake", amount: 1 }, ...SHARED.default] });
    await migrateRewardFiles();
    expect(read("dailyRewards_smp.json" + REWARDS_BACKUP_SUFFIX)).toBe(first);
  });
});

describe("a dry run and determinism", () => {
  it("reports what would change and writes nothing", async () => {
    write("dailyRewards.json", SHARED);
    write("dailyRewards_smp.json", SHARED);
    write("dailyRewards_cre.json", { default: [{ item: "minecraft:glass", amount: 64 }] });
    const before = readdirSync(dir).sort();
    const report = await migrateRewardFiles({ dryRun: true });
    expect(report.dryRun).toBe(true);
    expect(results(report)).toMatchObject({
      "dailyRewards.json": "migrated",
      "dailyRewards_cre.json": "migrated",
      "dailyRewards_smp.json": "removed",
    });
    expect(readdirSync(dir).sort()).toEqual(before);
    expect(JSON.parse(read("dailyRewards.json"))).toEqual(SHARED);
  });

  it("writes the same bytes every time, so two processes cannot disagree", async () => {
    const run = async (): Promise<string[]> => {
      write("dailyRewards.json", SHARED);
      write("dailyRewards_smp.json", { default: [...SHARED.default.slice(1), { item: "minecraft:apple", amount: 2, weight: 1 }] });
      await migrateRewardFiles();
      const out = [read("dailyRewards.json"), read("dailyRewards_smp.json")];
      for (const name of readdirSync(dir)) rmSync(file(name), { force: true });
      return out;
    };
    expect(await run()).toEqual(await run());
  });
});
