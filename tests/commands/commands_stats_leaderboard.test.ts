/**
 * Batch tests for stats-leaderboard commands: /leaderboard, /playtime
 * and the leaderboard scheduler (startLeaderboardScheduler).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/bot/commands/middleware.js", () => ({
  withErrorHandling: vi.fn((fn) => fn),
  requireServerAdmin: vi.fn((fn) => fn),
}));

vi.mock("../../src/bot/utils/guild/guildRouter.js", () => ({
  resolveServer: vi.fn(),
}));

vi.mock("../../src/core/utils/minecraft/statUtils.js", () => ({
  LEADERBOARD_STATS: {
    playtime: {
      label: "Playtime",
      extract: vi.fn().mockReturnValue(0),
      format: vi.fn().mockReturnValue("0s"),
      sortAscending: false,
    },
    deaths: {
      label: "Deaths",
      extract: vi.fn().mockReturnValue(0),
      format: vi.fn().mockReturnValue("0"),
      sortAscending: true,
    },
  },
  buildLeaderboard: vi.fn(),
  loadStats: vi.fn(),
  flattenStats: vi.fn().mockReturnValue([]),
  filterStats: vi.fn((s) => s),
  findPlayTimeStat: vi.fn().mockReturnValue(0),
  ticksToMs: vi.fn((n: number) => n * 50),
  formatDistance: vi.fn().mockReturnValue("0km"),
  humanizeKey: vi.fn((k) => k),
  invalidateAllStatsCache: vi.fn(),
}));

vi.mock("../../src/bot/utils/embeds/statEmbeds.js", () => ({
  buildLeaderboardEmbed: vi.fn().mockReturnValue({ type: "leaderboard-embed" }),
  buildStatsEmbeds: vi.fn().mockReturnValue([]),
}));

vi.mock("../../src/core/utils/minecraft/playerUtils.js", () => ({
  findPlayer: vi.fn(),
  getPlayerNames: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../src/bot/utils/embeds/embedUtils.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  createEmbed: vi
    .fn()
    .mockReturnValue({
      addFields: vi.fn().mockReturnThis(),
      setFooter: vi.fn().mockReturnThis(),
    }),
  createErrorEmbed: vi.fn().mockReturnValue({ type: "error-embed" }),
}));

vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../src/core/utils/jsonStore.js", () => ({
  loadJson: vi.fn().mockResolvedValue({}),
  saveJson: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/core/utils/paths.js", () => ({
  getRootDir: vi.fn().mockReturnValue("/tmp"),
}));

vi.mock("../../src/core/utils/server/server.js", () => ({
  getAllInstances: vi.fn().mockReturnValue([]),
  getServerInstance: vi.fn(),
}));

vi.mock("../../src/core/config.js", () => ({
  loadConfig: vi.fn().mockReturnValue({
    leaderboardInterval: "daily",
    adminUsers: [],
  }),
}));

vi.mock("../../src/core/utils/minecraft/snapshotUtils.js", () => ({
  takeSnapshot: vi.fn().mockResolvedValue({}),
  getSnapshotClosestTo: vi.fn().mockResolvedValue(null),
}));

import { resolveServer } from "../../src/bot/utils/guild/guildRouter.js";
import { buildLeaderboard } from "../../src/core/utils/minecraft/statUtils.js";
import { findPlayer } from "../../src/core/utils/minecraft/playerUtils.js";
import { loadStats } from "../../src/core/utils/minecraft/statUtils.js";

const fakeServer = { id: "survival" } as never;
const leaderboardData = {
  entries: [],
  title: "🏆 Leaderboard — Playtime",
  description: "No data available.",
  footerText: "0 players tracked",
};

function makeInteraction(opts: Record<string, unknown> = {}) {
  return {
    user: { id: "u1", tag: "User#0001" },
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue({ id: "msg1" }),
    options: {
      getString: vi.fn().mockReturnValue(null),
      getBoolean: vi.fn().mockReturnValue(null),
    },
    deferred: false,
    replied: false,
    ...opts,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolveServer).mockReturnValue(fakeServer);
  vi.mocked(buildLeaderboard).mockResolvedValue(leaderboardData);
});

// ══════════════════════════════════════════════════════════════════════════════
// /leaderboard
// ══════════════════════════════════════════════════════════════════════════════

describe("/leaderboard command", () => {
  let execute: (i: never) => Promise<void>;
  beforeEach(async () => {
    ({ execute } = await import("../../src/bot/commands/stats/leaderboard.js"));
  });

  it("calls buildLeaderboard with the selected stat", async () => {
    const interaction = makeInteraction({
      options: { getString: vi.fn().mockReturnValue("deaths") },
    });
    await execute(interaction);
    expect(buildLeaderboard).toHaveBeenCalledWith("deaths", expect.any(Object));
  });

  it("defaults to playtime when no stat selected", async () => {
    const interaction = makeInteraction({
      options: { getString: vi.fn().mockReturnValue(null) },
    });
    await execute(interaction);
    expect(buildLeaderboard).toHaveBeenCalledWith(
      "playtime",
      expect.any(Object),
    );
  });

  it("calls editReply with the leaderboard embed", async () => {
    const interaction = makeInteraction({
      options: { getString: vi.fn().mockReturnValue(null) },
    });
    await execute(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ embeds: expect.any(Array) }),
    );
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// /playtime
// ══════════════════════════════════════════════════════════════════════════════

describe("/playtime command", () => {
  let execute: (i: never) => Promise<void>;
  beforeEach(async () => {
    ({ execute } = await import("../../src/bot/commands/stats/playtime.js"));
  });

  it("fails with a recovery step when the player is not found", async () => {
    vi.mocked(findPlayer).mockResolvedValue(null);
    const interaction = makeInteraction({
      options: { getString: vi.fn().mockReturnValue("Unknown") },
    });
    await expect(execute(interaction)).rejects.toMatchObject({
      problem: expect.stringContaining("Unknown"),
      recovery: expect.stringContaining("spelling"),
    });
  });

  it("replies with error when stats file is missing", async () => {
    vi.mocked(findPlayer).mockResolvedValue({
      name: "Steve",
      uuid: "u1",
    } as never);
    vi.mocked(loadStats).mockResolvedValue(null);
    const interaction = makeInteraction({
      options: { getString: vi.fn().mockReturnValue("Steve") },
    });
    await expect(execute(interaction)).rejects.toThrow("No stats for `Steve` yet.");
  });

  it("replies with playtime embed on success", async () => {
    vi.mocked(findPlayer).mockResolvedValue({
      name: "Steve",
      uuid: "u1",
    } as never);
    vi.mocked(loadStats).mockResolvedValue({
      stats: { "minecraft:custom": { "minecraft:play_time": 72000 } },
    } as never);
    const { findPlayTimeStat } = await import("../../src/core/utils/minecraft/statUtils.js");
    vi.mocked(findPlayTimeStat).mockReturnValueOnce(72000);
    const interaction = makeInteraction({
      options: { getString: vi.fn().mockReturnValue("Steve") },
    });
    await execute(interaction);
    expect(interaction.editReply).toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// leaderboardScheduler — startLeaderboardScheduler
// ══════════════════════════════════════════════════════════════════════════════

describe("startLeaderboardScheduler", () => {
  let startLeaderboardScheduler: (
    client: never,
    guildConfigs: Record<string, never>,
  ) => unknown;
  beforeEach(async () => {
    ({ startLeaderboardScheduler } =
      await import("../../src/bot/logWatcher/watchers/schedulers/leaderboardScheduler.js"));
  });

  it("returns a handle that stops both pollers", () => {
    const result = startLeaderboardScheduler(null as never, {}) as { stop(): void };
    expect(result).toBeTruthy();
    result.stop();
  });

  it("does not throw when called with empty guild configs", () => {
    expect(() => {
      (startLeaderboardScheduler(null as never, {}) as { stop(): void }).stop();
    }).not.toThrow();
  });
});
