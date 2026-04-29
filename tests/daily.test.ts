/**
 * Tests for the /daily command logic.
 *
 * Covers:
 *  - calcStreak: streak increment, reset after miss, longestStreak tracking
 *  - pick: weighted random item selection
 *  - claimLock: concurrent executions are blocked for the same user
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Top-level mocks — must be at file scope for Vitest hoisting ───────────

vi.mock("../src/utils/linkUtils.js", () => ({
  isLinked: vi.fn(),
  getLinkedAccount: vi.fn(),
}));

vi.mock("../src/utils/playerUtils.js", () => ({
  getOnlinePlayers: vi.fn(),
}));

vi.mock("../src/utils/guildRouter.js", () => ({
  resolveServer: vi.fn(),
}));

vi.mock("../src/utils/embedUtils.js", () => ({
  createErrorEmbed: vi.fn().mockReturnValue({}),
}));

vi.mock("../src/utils/utils.js", () => ({
  getRootDir: vi.fn().mockReturnValue("/tmp"),
  loadJson: vi.fn(),
  saveJson: vi.fn(),
}));

// ── calcStreak & pick ──────────────────────────────────────────────────────
// Pure functions — import directly without Discord/FS side-effects.

const DAILY_COOLDOWN = 24 * 60 * 60 * 1000;
const TWO_DAYS = 2 * DAILY_COOLDOWN + 1;

const { calcStreak, pick, deriveMaxStreak } =
  await import("../src/commands/connection/daily/daily.js");

describe("calcStreak", () => {
  it("increments streak on consecutive claim", () => {
    const result = calcStreak(
      { currentStreak: 3, bonusStreak: 3, longestStreak: 5 },
      DAILY_COOLDOWN + 1000,
    );
    expect(result.currentStreak).toBe(4);
    expect(result.bonusStreak).toBe(4);
    expect(result.longestStreak).toBe(5); // unchanged — 4 < 5
  });

  it("resets streak after missing a day (delta > 48 h)", () => {
    const result = calcStreak(
      { currentStreak: 10, bonusStreak: 10, longestStreak: 10 },
      TWO_DAYS,
    );
    expect(result.currentStreak).toBe(1);
    expect(result.bonusStreak).toBe(1);
    expect(result.longestStreak).toBe(10); // preserved
  });

  it("updates longestStreak when currentStreak exceeds it", () => {
    const result = calcStreak(
      { currentStreak: 7, bonusStreak: 7, longestStreak: 7 },
      DAILY_COOLDOWN + 1000,
    );
    expect(result.currentStreak).toBe(8);
    expect(result.longestStreak).toBe(8);
  });

  it("resets bonusStreak to 1 after the cycle's top milestone (default 35)", () => {
    // After the top-milestone bonus has been awarded, the cycle restarts.
    // currentStreak keeps counting up — only the milestone position resets.
    const result = calcStreak(
      { currentStreak: 35, bonusStreak: 35, longestStreak: 35 },
      DAILY_COOLDOWN + 1000,
    );
    expect(result.bonusStreak).toBe(1);
    expect(result.currentStreak).toBe(36);
    expect(result.longestStreak).toBe(36);
  });

  it("respects a custom cycleMax passed by the caller", () => {
    // With cycleMax=121 (the current production config — 3 cycles per
    // 365-day year), bonusStreak=35 is mid-cycle and should keep
    // incrementing — not reset.
    const mid = calcStreak(
      { currentStreak: 35, bonusStreak: 35, longestStreak: 35 },
      DAILY_COOLDOWN + 1000,
      121,
    );
    expect(mid.bonusStreak).toBe(36);

    // At cycleMax=121 with bonusStreak=121, the cycle resets.
    const top = calcStreak(
      { currentStreak: 121, bonusStreak: 121, longestStreak: 121 },
      DAILY_COOLDOWN + 1000,
      121,
    );
    expect(top.bonusStreak).toBe(1);
    expect(top.currentStreak).toBe(122);
  });

  it("continues a cycle normally below the cap", () => {
    const result = calcStreak(
      { currentStreak: 50, bonusStreak: 14, longestStreak: 50 },
      DAILY_COOLDOWN + 1000,
    );
    expect(result.bonusStreak).toBe(15);
    expect(result.currentStreak).toBe(51);
  });
});

describe("deriveMaxStreak", () => {
  it("returns the highest milestone key from streakBonuses", () => {
    expect(
      deriveMaxStreak({
        "3": [{ item: "diamond", amount: 1 }],
        "121": [{ item: "beacon", amount: 1 }],
        "20": [{ item: "netherite_ingot", amount: 1 }],
      }),
    ).toBe(121);
  });

  it("falls back to the default when streakBonuses is missing", () => {
    expect(deriveMaxStreak(undefined)).toBe(35);
    expect(deriveMaxStreak({})).toBe(35);
  });

  it("ignores non-numeric or non-positive keys", () => {
    expect(
      deriveMaxStreak({
        "10": [{ item: "diamond", amount: 1 }],
        notanumber: [{ item: "diamond", amount: 1 }],
        "0": [{ item: "diamond", amount: 1 }],
        "-5": [{ item: "diamond", amount: 1 }],
      }),
    ).toBe(10);
  });
});

describe("pick", () => {
  it("always returns an item from the pool", () => {
    const pool = [
      { item: "minecraft:diamond", amount: 1, weight: 1 },
      { item: "minecraft:gold_ingot", amount: 3, weight: 5 },
    ];
    for (let i = 0; i < 100; i++) {
      expect(pool).toContain(pick(pool));
    }
  });

  it("returns the only item in a single-entry pool", () => {
    const pool = [{ item: "minecraft:emerald", amount: 2, weight: 1 }];
    expect(pick(pool)).toBe(pool[0]);
  });

  it("respects weight — high-weight item wins overwhelmingly", () => {
    const pool = [
      { item: "rare", amount: 1, weight: 1 },
      { item: "common", amount: 1, weight: 999 },
    ];
    const counts: Record<string, number> = { rare: 0, common: 0 };
    for (let i = 0; i < 1000; i++) {
      counts[pick(pool).item!]!++;
    }
    expect(counts["common"]!).toBeGreaterThan(900);
  });
});

// ── claimLock — concurrent claim prevention ────────────────────────────────

describe("claimLock — concurrent claim prevention", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function makeInteraction(userId = "user-1") {
    return {
      user: { id: userId },
      guild: { id: "guild-1" },
      options: { getString: vi.fn().mockReturnValue(null) },
      reply: vi.fn().mockResolvedValue(undefined),
    };
  }

  it("blocks a second concurrent execution for the same user", async () => {
    const utils = await import("../src/utils/utils.js");
    const linkUtils = await import("../src/utils/linkUtils.js");
    const playerUtils = await import("../src/utils/playerUtils.js");
    const guildRouter = await import("../src/utils/guildRouter.js");

    vi.mocked(linkUtils.isLinked).mockResolvedValue(true);
    vi.mocked(linkUtils.getLinkedAccount).mockResolvedValue("Steve");
    vi.mocked(playerUtils.getOnlinePlayers).mockResolvedValue(["Steve"]);
    vi.mocked(guildRouter.resolveServer).mockReturnValue({
      sendCommand: vi.fn().mockResolvedValue(null),
    } as never);
    vi.mocked(utils.getRootDir).mockReturnValue("/tmp");
    vi.mocked(utils.loadJson).mockResolvedValue({
      default: [{ item: "minecraft:diamond", amount: 1, weight: 1 }],
      streakBonuses: {},
    });

    // saveJson that never resolves — keeps the first execution inside the lock.
    let releaseSave!: () => void;
    const savePending = new Promise<void>((res) => {
      releaseSave = res;
    });
    vi.mocked(utils.saveJson).mockReturnValue(savePending as never);

    const { execute } =
      await import("../src/commands/connection/daily/daily.js");

    const i1 = makeInteraction();
    const i2 = makeInteraction();

    // Start first execution — hangs at saveJson.
    const p1 = execute(i1 as never);
    // Yield so i1 enters the lock before i2 starts.
    await new Promise((r) => setTimeout(r, 0));

    // Second execution for the same user must be rejected immediately.
    await execute(i2 as never);
    expect(i2.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("Already processing"),
      }),
    );

    // Release the first execution.
    releaseSave();
    await p1;
  });

  it("allows a second execution for a different user", async () => {
    const linkUtils = await import("../src/utils/linkUtils.js");

    // Fail fast after the lock check — we only care that neither user gets blocked.
    vi.mocked(linkUtils.isLinked).mockResolvedValue(false);

    const { execute } =
      await import("../src/commands/connection/daily/daily.js");

    const iA = makeInteraction("user-A");
    const iB = makeInteraction("user-B");

    await Promise.all([execute(iA as never), execute(iB as never)]);

    // Neither should receive the "Already processing" lock message.
    for (const call of [...iA.reply.mock.calls, ...iB.reply.mock.calls]) {
      expect((call[0] as { content?: string }).content ?? "").not.toContain(
        "Already processing",
      );
    }
  });
});
