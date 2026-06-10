import { describe, it, expect } from "vitest";
import {
  formatPlaytime,
  findPlayTimeStat,
  formatDistance,
  humanizeKey,
  LEADERBOARD_STATS,
  invalidateAllStatsCache,
} from "../src/utils/statUtils.js";
import type { FlattenedStat } from "../src/types/index.js";

// ── formatPlaytime ────────────────────────────────────────────────────────────

describe("formatPlaytime", () => {
  it("returns '0s' for 0 ticks", () => {
    expect(formatPlaytime(0)).toBe("0s");
  });

  it("returns '0s' for negative ticks", () => {
    expect(formatPlaytime(-500)).toBe("0s");
  });

  it("returns '0s' for non-numeric input", () => {
    expect(formatPlaytime("xyz" as unknown as number)).toBe("0s");
  });

  it("formats ticks under 60 seconds correctly", () => {
    // 200 ticks = 10 seconds
    expect(formatPlaytime(200)).toBe("0d 0h 0m 10s");
  });

  it("formats exactly 1 minute", () => {
    // 60s * 20 = 1200 ticks
    expect(formatPlaytime(1200)).toBe("0d 0h 1m 0s");
  });

  it("formats exactly 1 hour", () => {
    // 3600s * 20 = 72000 ticks
    expect(formatPlaytime(72000)).toBe("0d 1h 0m 0s");
  });

  it("formats exactly 1 day", () => {
    // 86400s * 20 = 1728000 ticks
    expect(formatPlaytime(1728000)).toBe("1d 0h 0m 0s");
  });

  it("formats a complex value with all parts", () => {
    // 2d 3h 5m 7s = (2*86400 + 3*3600 + 5*60 + 7) * 20 ticks
    const seconds = 2 * 86400 + 3 * 3600 + 5 * 60 + 7;
    expect(formatPlaytime(seconds * 20)).toBe("2d 3h 5m 7s");
  });
});

// ── findPlayTimeStat ──────────────────────────────────────────────────────────

describe("findPlayTimeStat", () => {
  it("returns 0 for an empty array", () => {
    expect(findPlayTimeStat([])).toBe(0);
  });

  it("returns 0 for null input", () => {
    expect(findPlayTimeStat(null as unknown as FlattenedStat[])).toBe(0);
  });

  it("finds play_time in the modern nested format", () => {
    const stats: FlattenedStat[] = [
      {
        fullKey: "minecraft:custom.minecraft:play_time",
        category: "minecraft:custom",
        key: "minecraft:play_time",
        value: 72000,
      },
    ];
    expect(findPlayTimeStat(stats)).toBe(72000);
  });

  it("finds stat.playOneMinute in the legacy flat format", () => {
    const stats: FlattenedStat[] = [
      {
        fullKey: "stat.playOneMinute",
        category: "stat",
        key: "playOneMinute",
        value: 4800,
      },
    ];
    expect(findPlayTimeStat(stats)).toBe(4800);
  });

  it("returns 0 when no playtime stat is present", () => {
    const stats: FlattenedStat[] = [
      {
        fullKey: "minecraft:custom.minecraft:deaths",
        category: "minecraft:custom",
        key: "minecraft:deaths",
        value: 10,
      },
    ];
    expect(findPlayTimeStat(stats)).toBe(0);
  });
});

// ── formatDistance ────────────────────────────────────────────────────────────

describe("formatDistance", () => {
  it("formats 0 cm", () => {
    expect(formatDistance(0)).toBe("0km 0.00m");
  });

  it("formats 100 cm as 1 meter", () => {
    expect(formatDistance(100)).toBe("0km 1.00m");
  });

  it("formats exactly 1 km (100000 cm)", () => {
    expect(formatDistance(100_000)).toBe("1km 0.00m");
  });

  it("formats fractional meters", () => {
    expect(formatDistance(150)).toBe("0km 1.50m");
  });

  it("formats large distances with both km and meters", () => {
    // 5,250,000 cm = 52500 m = 52 km + 500 m
    expect(formatDistance(5_250_000)).toBe("52km 500.00m");
  });

  it("formats less than 1 meter", () => {
    // 50 cm = 0.50 m
    expect(formatDistance(50)).toBe("0km 0.50m");
  });
});

// ── humanizeKey ───────────────────────────────────────────────────────────────

describe("humanizeKey", () => {
  it("strips the minecraft: prefix", () => {
    expect(humanizeKey("minecraft:deaths")).toBe("Deaths");
  });

  it("replaces underscores with spaces", () => {
    expect(humanizeKey("walk_one_cm")).toBe("Walk One Cm");
  });

  it("capitalizes the first letter of each word", () => {
    expect(humanizeKey("mob_kills")).toBe("Mob Kills");
  });

  it("handles keys with both prefix and underscores", () => {
    expect(humanizeKey("minecraft:play_time")).toBe("Play Time");
  });

  it("handles a single word key", () => {
    expect(humanizeKey("deaths")).toBe("Deaths");
  });

  it("returns the key as-is (capitalized) when already clean", () => {
    expect(humanizeKey("stone")).toBe("Stone");
  });
});

// ── LEADERBOARD_STATS ─────────────────────────────────────────────────────────

const testStats: FlattenedStat[] = [
  {
    fullKey: "minecraft:custom.minecraft:play_time",
    category: "minecraft:custom",
    key: "minecraft:play_time",
    value: 72000,
  },
  {
    fullKey: "minecraft:killed.minecraft:zombie",
    category: "minecraft:killed",
    key: "minecraft:zombie",
    value: 30,
  },
  {
    fullKey: "minecraft:killed.minecraft:skeleton",
    category: "minecraft:killed",
    key: "minecraft:skeleton",
    value: 15,
  },
  {
    fullKey: "minecraft:custom.minecraft:deaths",
    category: "minecraft:custom",
    key: "minecraft:deaths",
    value: 5,
  },
  {
    fullKey: "minecraft:mined.minecraft:stone",
    category: "minecraft:mined",
    key: "minecraft:stone",
    value: 100,
  },
  {
    fullKey: "minecraft:mined.minecraft:dirt",
    category: "minecraft:mined",
    key: "minecraft:dirt",
    value: 50,
  },
  {
    fullKey: "minecraft:custom.minecraft:walk_one_cm",
    category: "minecraft:custom",
    key: "minecraft:walk_one_cm",
    value: 50000,
  },
];

describe("LEADERBOARD_STATS.playtime", () => {
  const def = LEADERBOARD_STATS["playtime"]!;

  it("extracts play_time value", () => {
    expect(def.extract(testStats)).toBe(72000);
  });

  it("formats as a human-readable string", () => {
    expect(def.format(72000)).toBe("0d 1h 0m 0s");
  });

  it("sorts descending (highest playtime first)", () => {
    expect(def.sortAscending).toBe(false);
  });
});

describe("LEADERBOARD_STATS.mob_kills", () => {
  const def = LEADERBOARD_STATS["mob_kills"]!;

  it("sums all minecraft:killed entries", () => {
    expect(def.extract(testStats)).toBe(45); // 30 + 15
  });

  it("returns 0 when no kills present", () => {
    expect(def.extract([])).toBe(0);
  });

  it("formats with toLocaleString", () => {
    expect(typeof def.format(1000)).toBe("string");
  });
});

describe("LEADERBOARD_STATS.deaths", () => {
  const def = LEADERBOARD_STATS["deaths"]!;

  it("extracts the deaths value", () => {
    expect(def.extract(testStats)).toBe(5);
  });

  it("returns 0 when deaths stat is absent", () => {
    expect(def.extract([])).toBe(0);
  });

  it("sorts ascending (fewest deaths first)", () => {
    expect(def.sortAscending).toBe(true);
  });
});

describe("LEADERBOARD_STATS.mined", () => {
  const def = LEADERBOARD_STATS["mined"]!;

  it("sums all minecraft:mined entries", () => {
    expect(def.extract(testStats)).toBe(150); // 100 + 50
  });

  it("returns 0 when nothing was mined", () => {
    expect(def.extract([])).toBe(0);
  });
});

describe("LEADERBOARD_STATS.walked", () => {
  const def = LEADERBOARD_STATS["walked"]!;

  it("extracts walk_one_cm value", () => {
    expect(def.extract(testStats)).toBe(50000);
  });

  it("returns 0 when walk stat is absent", () => {
    expect(def.extract([])).toBe(0);
  });

  it("formats as distance string", () => {
    expect(def.format(50000)).toBe("0km 500.00m");
  });
});

// ── invalidateAllStatsCache ───────────────────────────────────────────────────

describe("invalidateAllStatsCache", () => {
  it("runs without throwing for a specific server ID", () => {
    expect(() => invalidateAllStatsCache("test-server")).not.toThrow();
  });

  it("runs without throwing when called with no argument", () => {
    expect(() => invalidateAllStatsCache()).not.toThrow();
  });
});
