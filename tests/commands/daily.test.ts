/**
 * Tests for the /daily command logic.
 *
 * Covers:
 *  - calcStreak: streak increment, reset after miss, longestStreak tracking
 *  - pick: weighted random item selection
 *  - claimLock: concurrent executions are blocked for the same user
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";

// ── Top-level mocks — must be at file scope for Vitest hoisting ───────────

vi.mock("../../src/core/utils/server/serverAccess.js", () => ({
}));
vi.mock("../../src/core/utils/stores/linkUtils.js", () => ({
  isLinked: vi.fn(),
  getLinkedAccount: vi.fn(),
}));

// Only the IO is stubbed. `isPlayerOnline` is a pure name comparison and is
// deliberately left real: it is the thing the online/offline branch turns on,
// so faking it here would test the mock instead of the matching rule.
vi.mock("../../src/core/utils/minecraft/playerUtils.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/core/utils/minecraft/playerUtils.js")>()),
  getOnlinePlayers: vi.fn(),
}));

vi.mock("../../src/bot/utils/guild/guildRouter.js", () => ({
  resolveServer: vi.fn(),
}));

vi.mock("../../src/bot/utils/hints/followUps.js", () => ({
  attachFollowUpHint: vi.fn().mockResolvedValue(undefined),
}));

/** The first embed of a reply payload, as JSON. */
function embedOf(payload: unknown): { title?: string; description?: string } {
  return (payload as { embeds: { toJSON(): { title?: string; description?: string } }[] })
    .embeds[0]!.toJSON();
}

vi.mock("../../src/core/utils/jsonStore.js", () => ({
  loadJson: vi.fn(),
  saveJson: vi.fn(),
}));

vi.mock("../../src/core/utils/paths.js", () => ({
  getRootDir: vi.fn().mockReturnValue("/tmp"),
}));

beforeAll(async () => {
  await import("../../src/bot/commands/connection/daily/daily.js");
}, 120_000);

// ── calcStreak & pick ──────────────────────────────────────────────────────
// Pure functions — import directly without Discord/FS side-effects.

import { kvGet, kvSet } from "../../src/core/db/kv.js";
import { closeDbForTesting } from "../../src/core/db/index.js";

beforeEach(() => {
  closeDbForTesting(); // fresh in-memory DB per test (claims live in kv now)
});

const DAILY_COOLDOWN = 24 * 60 * 60 * 1000;
const TWO_DAYS = 2 * DAILY_COOLDOWN + 1;

// The pure reward rules moved to core; the command only formats them now.
const { calcStreak, pick, deriveMaxStreak } = await import(
  "../../src/core/utils/minecraft/rewards.js"
);

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
      deferred: false,
      ephemeral: null as boolean | null,
      deferReply: vi.fn().mockImplementation(async function (this: { deferred: boolean; ephemeral: boolean | null }, options?: { flags?: number }) {
        this.deferred = true;
        this.ephemeral = Boolean(options?.flags);
      }),
      editReply: vi.fn().mockResolvedValue(undefined),
      deleteReply: vi.fn().mockResolvedValue(undefined),
      followUp: vi.fn().mockResolvedValue(undefined),
    };
  }

  it("blocks a second concurrent execution for the same user", async () => {
    const utils = await import("../../src/core/utils/jsonStore.js");
    const paths = await import("../../src/core/utils/paths.js");
    const linkUtils = await import("../../src/core/utils/stores/linkUtils.js");
    const playerUtils = await import("../../src/core/utils/minecraft/playerUtils.js");
    const guildRouter = await import("../../src/bot/utils/guild/guildRouter.js");

    vi.mocked(linkUtils.isLinked).mockResolvedValue(true);
    vi.mocked(linkUtils.getLinkedAccount).mockResolvedValue("Steve");
    vi.mocked(playerUtils.getOnlinePlayers).mockResolvedValue(["Steve"]);
    // A give that never answers — keeps the first execution inside the lock
    // (claims persist synchronously to kv now, so the held awaitable has to
    // be the round-trip to the server, not the save).
    let releaseSend!: () => void;
    const sendPending = new Promise<unknown>((res) => {
      releaseSend = () => res({ kind: "sent", via: "screen" });
    });
    vi.mocked(guildRouter.resolveServer).mockReturnValue({
      id: "main",
      config: { apiUrl: "http://w:3030", apiKey: "k" },
      send: vi.fn().mockReturnValue(sendPending),
    } as never);
    vi.mocked(paths.getRootDir).mockReturnValue("/tmp");
    vi.mocked(utils.loadJson).mockResolvedValue({
      default: [{ item: "minecraft:diamond", amount: 1, weight: 1 }],
      streakBonuses: {},
    });

    const { execute } =
      await import("../../src/bot/commands/connection/daily/daily.js");

    const i1 = makeInteraction();
    const i2 = makeInteraction();

    // Start first execution; it hangs inside give() at send.
    const p1 = execute(i1 as never);
    // Yield so i1 enters the lock before i2 starts.
    await new Promise((r) => setTimeout(r, 0));

    // Second execution for the same user must be rejected immediately.
    await execute(i2 as never);
    expect(embedOf(i2.followUp.mock.calls[0]![0]).description).toContain(
      "still being processed",
    );

    // Release the first execution.
    releaseSend();
    await p1;
  });

  it("allows a second execution for a different user", async () => {
    const linkUtils = await import("../../src/core/utils/stores/linkUtils.js");

    // Fail fast after the lock check — we only care that neither user gets blocked.
    vi.mocked(linkUtils.isLinked).mockResolvedValue(false);

    const { execute } =
      await import("../../src/bot/commands/connection/daily/daily.js");

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

// ── Reward history cap + optional-field preservation ───────────────────────

describe("claim persistence", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function runClaim(existingUserData: Record<string, unknown>) {
    const utils = await import("../../src/core/utils/jsonStore.js");
    const paths = await import("../../src/core/utils/paths.js");
    const linkUtils = await import("../../src/core/utils/stores/linkUtils.js");
    const playerUtils = await import("../../src/core/utils/minecraft/playerUtils.js");
    const guildRouter = await import("../../src/bot/utils/guild/guildRouter.js");

    // Mocked modules are singletons across vi.resetModules() — the call
    // history of earlier describes (claimLock) leaks into this one. Clear
    // it so assertions below only see this test's calls.
    vi.mocked(utils.saveJson).mockClear();
    vi.mocked(utils.loadJson).mockClear();

    vi.mocked(linkUtils.isLinked).mockResolvedValue(true);
    vi.mocked(linkUtils.getLinkedAccount).mockResolvedValue("Steve");
    vi.mocked(playerUtils.getOnlinePlayers).mockResolvedValue(["Steve"]);
    vi.mocked(guildRouter.resolveServer).mockReturnValue({
      id: "main",
      config: { apiUrl: "http://w:3030", apiKey: "k" },
      send: vi
        .fn()
        .mockResolvedValue({ kind: "delivered", output: "Gave 1 [Diamond] to Steve" }),
    } as never);
    vi.mocked(paths.getRootDir).mockReturnValue("/tmp");
    // vi.resetModules() gives daily.js a fresh db module instance — seed
    // and read through the SAME registry, not the file-scope import.
    const { kvGet, kvSet } = await import("../../src/core/db/kv.js");
    const { closeDbForTesting } = await import("../../src/core/db/index.js");
    closeDbForTesting();
    kvSet("claimedDaily", {
      version: 2,
      servers: { main: { "user-1": existingUserData } },
    });
    vi.mocked(utils.loadJson).mockResolvedValue({
      default: [{ item: "minecraft:diamond", amount: 1, weight: 1 }],
      streakBonuses: {},
    });

    const { execute } = await import(
      "../../src/bot/commands/connection/daily/daily.js"
    );
    const interaction = {
      user: { id: "user-1" },
      guild: { id: "guild-1" },
      options: { getString: vi.fn().mockReturnValue(null) },
      reply: vi.fn().mockResolvedValue(undefined),
      deferReply: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined),
    };
    await execute(interaction as never);

    const store = kvGet<{
      version: number;
      servers: Record<string, Record<string, unknown>>;
    }>("claimedDaily");
    expect(store).not.toBeNull();
    expect(store!.version).toBe(2);
    return store!.servers["main"]!["user-1"]!;
  }

  it("caps the per-user reward history at 30 entries", async () => {
    const fullHistory = Array.from({ length: 30 }, (_, i) => ({
      date: i,
      items: [],
      streak: i,
    }));
    const saved = await runClaim({
      lastClaim: 0,
      currentStreak: 3,
      bonusStreak: 3,
      longestStreak: 5,
      rewards: fullHistory,
    });

    const rewards = saved.rewards as Array<{ date: number }>;
    expect(rewards).toHaveLength(30); // 31st entry pushed the oldest out
    expect(rewards[0]!.date).toBe(1); // oldest (date: 0) dropped
    expect(rewards[29]!.date).toBeGreaterThan(1_000_000); // newest = Date.now()
  });

  it("preserves reminder opt-in fields across a claim", async () => {
    const saved = await runClaim({
      lastClaim: 0,
      currentStreak: 1,
      bonusStreak: 1,
      longestStreak: 1,
      rewards: [],
      remind: true,
      lastReminderAt: 12345,
    });

    expect(saved.remind).toBe(true);
    expect(saved.lastReminderAt).toBe(12345);
    expect((saved.rewards as unknown[]).length).toBe(1);
  });
});


// ── Per-server claims: cooldowns and streaks are independent per server ─────

describe("per-server claim independence", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("a cooldown on one server does not block claiming on another", async () => {
    const utils = await import("../../src/core/utils/jsonStore.js");
    const paths = await import("../../src/core/utils/paths.js");
    const linkUtils = await import("../../src/core/utils/stores/linkUtils.js");
    const playerUtils = await import("../../src/core/utils/minecraft/playerUtils.js");
    const guildRouter = await import("../../src/bot/utils/guild/guildRouter.js");

    vi.mocked(utils.saveJson).mockClear();
    vi.mocked(utils.loadJson).mockClear();

    vi.mocked(linkUtils.isLinked).mockResolvedValue(true);
    vi.mocked(linkUtils.getLinkedAccount).mockResolvedValue("Steve");
    vi.mocked(playerUtils.getOnlinePlayers).mockResolvedValue(["Steve"]);
    // The user targets "main" — while "other" is mid-cooldown.
    vi.mocked(guildRouter.resolveServer).mockReturnValue({
      id: "main",
      config: { apiUrl: "http://w:3030", apiKey: "k" },
      send: vi
        .fn()
        .mockResolvedValue({ kind: "delivered", output: "Gave 1 [Diamond] to Steve" }),
    } as never);
    vi.mocked(paths.getRootDir).mockReturnValue("/tmp");
    const { kvGet, kvSet } = await import("../../src/core/db/kv.js");
    const { closeDbForTesting } = await import("../../src/core/db/index.js");
    closeDbForTesting();

    const freshClaimOnOther = {
      lastClaim: Date.now(), // just claimed there — cooldown active
      currentStreak: 3,
      bonusStreak: 3,
      longestStreak: 3,
      rewards: [],
    };
    kvSet("claimedDaily", {
      version: 2,
      servers: { other: { "user-1": { ...freshClaimOnOther } } },
    });
    vi.mocked(utils.loadJson).mockResolvedValue({
      default: [{ item: "minecraft:diamond", amount: 1, weight: 1 }],
      streakBonuses: {},
    });

    const { execute } = await import(
      "../../src/bot/commands/connection/daily/daily.js"
    );
    const interaction = {
      user: { id: "user-1" },
      guild: { id: "guild-1" },
      options: { getString: vi.fn().mockReturnValue(null) },
      reply: vi.fn().mockResolvedValue(undefined),
      deferReply: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined),
    };
    await execute(interaction as never);

    // The claim on "main" went through despite the cooldown on "other"…
    const store = kvGet<{
      servers: Record<
        string,
        Record<string, { lastClaim: number; rewards: unknown[] }>
      >;
    }>("claimedDaily")!;
    expect(store).toBeTruthy();
    expect(store.servers["main"]!["user-1"]!.rewards).toHaveLength(1);
    // …and the "other" server's record is untouched.
    expect(store.servers["other"]!["user-1"]!.lastClaim).toBe(
      freshClaimOnOther.lastClaim,
    );
    expect(store.servers["other"]!["user-1"]!.rewards).toHaveLength(0);
  });
});

// ── Deferral, edited replies and ephemeral failures ─────────────────────────

describe("deferred replies", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function setup(opts: {
    online: boolean;
    send?: unknown;
    resolveThrows?: boolean;
    pool?: unknown;
  }) {
    const utils = await import("../../src/core/utils/jsonStore.js");
    const linkUtils = await import("../../src/core/utils/stores/linkUtils.js");
    const playerUtils = await import("../../src/core/utils/minecraft/playerUtils.js");
    const guildRouter = await import("../../src/bot/utils/guild/guildRouter.js");
    const { closeDbForTesting } = await import("../../src/core/db/index.js");
    closeDbForTesting();

    vi.mocked(linkUtils.isLinked).mockResolvedValue(true);
    vi.mocked(linkUtils.getLinkedAccount).mockResolvedValue("Steve");
    vi.mocked(playerUtils.getOnlinePlayers).mockResolvedValue(
      opts.online ? ["Steve"] : [],
    );
    if (opts.resolveThrows) {
      vi.mocked(guildRouter.resolveServer).mockImplementation(() => {
        throw new Error("Server not found.");
      });
    } else {
      vi.mocked(guildRouter.resolveServer).mockReturnValue({
        id: "main",
        config: { apiUrl: "http://w:3030", apiKey: "k" },
        send: vi
          .fn()
          .mockResolvedValue(
            opts.send ?? { kind: "delivered", output: "Gave 1 [Diamond] to Steve" },
          ),
      } as never);
    }
    vi.mocked(utils.loadJson).mockResolvedValue(
      opts.pool ?? {
        default: [{ item: "minecraft:diamond", amount: 1, weight: 1 }],
        streakBonuses: {},
      },
    );

    const { execute } = await import(
      "../../src/bot/commands/connection/daily/daily.js"
    );
    const interaction = {
      user: { id: "user-1" },
      guild: { id: "guild-1" },
      guildId: "guild-1",
      options: { getString: vi.fn().mockReturnValue(null) },
      reply: vi.fn().mockResolvedValue(undefined),
      deferred: false,
      ephemeral: null as boolean | null,
      deferReply: vi.fn().mockImplementation(async function (this: { deferred: boolean; ephemeral: boolean | null }, options?: { flags?: number }) {
        this.deferred = true;
        this.ephemeral = Boolean(options?.flags);
      }),
      editReply: vi.fn().mockResolvedValue(undefined),
      deleteReply: vi.fn().mockResolvedValue(undefined),
      followUp: vi.fn().mockResolvedValue(undefined),
    };
    return { execute, interaction };
  }

  it("defers publicly and edits the reply on a successful online claim", async () => {
    const { execute, interaction } = await setup({ online: true });
    await execute(interaction as never);
    expect(interaction.deferReply).toHaveBeenCalledWith({});
    expect(interaction.reply).not.toHaveBeenCalled();
    expect(interaction.followUp).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledTimes(1);
    expect(embedOf(interaction.editReply.mock.calls[0]![0]).title).toBe("🎁 Daily reward claimed");
  });

  it("keeps the queued reward public on an offline claim", async () => {
    const { execute, interaction } = await setup({ online: false });
    await execute(interaction as never);
    expect(interaction.deferReply).toHaveBeenCalledWith({});
    expect(interaction.followUp).not.toHaveBeenCalled();
  });

  it("shows the cooldown only to the claimer", async () => {
    const { execute, interaction } = await setup({ online: true });
    await execute(interaction as never);
    interaction.deleteReply.mockClear();
    interaction.followUp.mockClear();
    interaction.deferred = false;
    await execute(interaction as never);
    expect(interaction.deleteReply).toHaveBeenCalledTimes(1);
    expect(interaction.followUp).toHaveBeenCalledWith(
      expect.objectContaining({ flags: 64 }),
    );
    expect(embedOf(interaction.followUp.mock.calls[0]![0]).title).toBe("⏳ Already claimed");
  });

  it("edits the reply with the queued note on an offline claim", async () => {
    const { execute, interaction } = await setup({ online: false });
    await execute(interaction as never);
    expect(interaction.deferReply).toHaveBeenCalled();
    expect(embedOf(interaction.editReply.mock.calls[0]![0]).description).toContain("main");
  });

  it("answers a full queue with an error only the claimer sees", async () => {
    const { execute, interaction } = await setup({ online: false });
    const { kvSet } = await import("../../src/core/db/kv.js");
    const { MAX_PENDING_PER_PLAYER } = await import(
      "../../src/core/utils/stores/dailyStore.js"
    );
    kvSet("pendingRewards", {
      version: 1,
      servers: {
        main: {
          steve: Array.from({ length: MAX_PENDING_PER_PLAYER }, () => ({
            discordId: "user-1",
            items: [],
            queuedAt: 0,
          })),
        },
      },
    });
    await execute(interaction as never);
    expect(interaction.editReply).not.toHaveBeenCalled();
    expect(interaction.deleteReply).toHaveBeenCalledTimes(1);
    expect(interaction.followUp).toHaveBeenCalledWith(
      expect.objectContaining({ flags: 64 }),
    );
    expect(embedOf(interaction.followUp.mock.calls[0]![0]).title).toBe("⛔ Rewards waiting in game");
  });

  it("answers a failed delivery with an error only the claimer sees", async () => {
    const { execute, interaction } = await setup({
      online: true,
      send: { kind: "unreachable", reason: "timeout", detail: "x" },
    });
    await execute(interaction as never);
    expect(interaction.editReply).not.toHaveBeenCalled();
    expect(interaction.followUp).toHaveBeenCalledWith(
      expect.objectContaining({ flags: 64 }),
    );
    expect(embedOf(interaction.followUp.mock.calls[0]![0]).title).toBe("⛔ Reward not delivered");
  });

  it("answers an unresolvable server ephemerally", async () => {
    const { execute, interaction } = await setup({
      online: true,
      resolveThrows: true,
    });
    await execute(interaction as never);
    expect(interaction.editReply).not.toHaveBeenCalled();
    expect(interaction.followUp).toHaveBeenCalledWith(
      expect.objectContaining({ flags: 64 }),
    );
    expect(interaction.reply).not.toHaveBeenCalled();
  });

  it("shows the main reward as the daily reward and the random bonus on its own line", async () => {
    // Order of Math.random calls: pick main, bonus-chance roll, pick bonus.
    vi.spyOn(Math, "random")
      .mockReturnValueOnce(0.1)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0.9);
    const { execute, interaction } = await setup({
      online: true,
      pool: {
        default: [
          { item: "minecraft:apple", amount: 1, weight: 1 },
          { item: "minecraft:bread", amount: 1, weight: 1 },
        ],
        bonusChance: 100,
        streakBonuses: {},
      },
    });
    await execute(interaction as never);
    const text = embedOf(interaction.editReply.mock.calls[0]![0]).description ?? "";
    expect(text).toContain("1 × Apple");
    expect(text).toContain("Lucky bonus: 1 × Bread");
  });
});
