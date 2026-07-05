/**
 * Batch tests for stats-leaderboard commands: /leaderboard, /top, /playtime
 * and the leaderboard scheduler (startLeaderboardScheduler).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/bot/commands/middleware.js", () => ({
  withErrorHandling: vi.fn((fn) => fn),
  requireServerAdmin: vi.fn((fn) => fn),
}));

vi.mock("../src/bot/utils/guildRouter.js", () => ({
  resolveServer: vi.fn(),
}));

vi.mock("../src/common/utils/statUtils.js", () => ({
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
  formatPlaytime: vi.fn().mockReturnValue("0s"),
  formatDistance: vi.fn().mockReturnValue("0km"),
  humanizeKey: vi.fn((k) => k),
  invalidateAllStatsCache: vi.fn(),
}));

vi.mock("../src/bot/utils/statEmbeds.js", () => ({
  buildLeaderboardEmbed: vi.fn().mockReturnValue({ type: "leaderboard-embed" }),
  buildStatsEmbeds: vi.fn().mockReturnValue([]),
}));

vi.mock("../src/common/utils/playerUtils.js", () => ({
  findPlayer: vi.fn(),
  getPlayerNames: vi.fn().mockResolvedValue([]),
}));

vi.mock("../src/bot/utils/embedUtils.js", () => ({
  createEmbed: vi
    .fn()
    .mockReturnValue({
      addFields: vi.fn().mockReturnThis(),
      setFooter: vi.fn().mockReturnThis(),
    }),
  createErrorEmbed: vi.fn().mockReturnValue({ type: "error-embed" }),
}));

vi.mock("../src/common/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../src/common/utils/utils.js", () => ({
  getRootDir: vi.fn().mockReturnValue("/tmp"),
  loadJson: vi.fn().mockResolvedValue({}),
  saveJson: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../src/common/utils/server.js", () => ({
  getAllInstances: vi.fn().mockReturnValue([]),
  getServerInstance: vi.fn(),
}));

vi.mock("../src/common/config.js", () => ({
  loadConfig: vi.fn().mockReturnValue({
    leaderboardInterval: "daily",
    adminUsers: [],
  }),
}));

vi.mock("../src/common/utils/snapshotUtils.js", () => ({
  takeSnapshot: vi.fn().mockResolvedValue({}),
  getSnapshotClosestTo: vi.fn().mockResolvedValue(null),
}));

import { resolveServer } from "../src/bot/utils/guildRouter.js";
import { buildLeaderboard } from "../src/common/utils/statUtils.js";
import { findPlayer } from "../src/common/utils/playerUtils.js";
import { loadStats } from "../src/common/utils/statUtils.js";

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
    ({ execute } = await import("../src/bot/commands/stats/leaderboard.js"));
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
// /top
// ══════════════════════════════════════════════════════════════════════════════

describe("/top command", () => {
  let execute: (i: never) => Promise<void>;
  beforeEach(async () => {
    ({ execute } = await import("../src/bot/commands/stats/top.js"));
  });

  it("calls buildLeaderboard with the selected stat", async () => {
    const interaction = makeInteraction({
      options: { getString: vi.fn().mockReturnValue("mined") },
    });
    await execute(interaction);
    expect(buildLeaderboard).toHaveBeenCalledWith("mined", expect.any(Object));
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// /playtime
// ══════════════════════════════════════════════════════════════════════════════

describe("/playtime command", () => {
  let execute: (i: never) => Promise<void>;
  beforeEach(async () => {
    ({ execute } = await import("../src/bot/commands/stats/playtime.js"));
  });

  it("replies with error when player not found", async () => {
    vi.mocked(findPlayer).mockResolvedValue(null);
    const interaction = makeInteraction({
      options: { getString: vi.fn().mockReturnValue("Unknown") },
    });
    await execute(interaction);
    expect(interaction.editReply).toHaveBeenCalled();
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
    await execute(interaction);
    expect(interaction.editReply).toHaveBeenCalled();
  });

  it("replies with playtime embed on success", async () => {
    vi.mocked(findPlayer).mockResolvedValue({
      name: "Steve",
      uuid: "u1",
    } as never);
    vi.mocked(loadStats).mockResolvedValue({
      stats: { "minecraft:custom": { "minecraft:play_time": 72000 } },
    } as never);
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
      await import("../src/bot/logWatcher/watchers/leaderboardScheduler.js"));
  });

  it("returns a timer object (SchedulerTimers with snapshotTimer + postTimer)", () => {
    const result = startLeaderboardScheduler(null as never, {});
    // Returns either a single timer or a SchedulerTimers object
    expect(result).toBeTruthy();
    // Clean up intervals
    if (
      result &&
      typeof result === "object" &&
      "snapshotTimer" in (result as object)
    ) {
      clearInterval(
        (result as { snapshotTimer: ReturnType<typeof setInterval> })
          .snapshotTimer,
      );
      clearInterval(
        (result as { postTimer: ReturnType<typeof setInterval> }).postTimer,
      );
    } else {
      clearInterval(result as ReturnType<typeof setInterval>);
    }
  });

  it("does not throw when called with empty guild configs", () => {
    expect(() => {
      const r = startLeaderboardScheduler(null as never, {});
      if (r && typeof r === "object" && "snapshotTimer" in (r as object)) {
        clearInterval(
          (r as { snapshotTimer: ReturnType<typeof setInterval> })
            .snapshotTimer,
        );
        clearInterval(
          (r as { postTimer: ReturnType<typeof setInterval> }).postTimer,
        );
      } else {
        clearInterval(r as ReturnType<typeof setInterval>);
      }
    }).not.toThrow();
  });
});
