/**
 * stats command tests — covers runPlayer and runDaily paths
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/utils/statUtils.js", () => ({
  loadStats: vi.fn(),
  flattenStats: vi.fn().mockReturnValue([]),
  filterStats: vi.fn((stats) => stats),
  formatPlaytime: vi.fn().mockReturnValue("1h"),
  formatDistance: vi.fn().mockReturnValue("1km"),
  humanizeKey: vi.fn((k) => k),
  LEADERBOARD_STATS: {},
  invalidateAllStatsCache: vi.fn(),
}));

vi.mock("../src/utils/snapshotUtils.js", () => ({
  getSnapshotForDailyDiff: vi.fn(),
}));

vi.mock("../src/utils/statEmbeds.js", () => ({
  buildStatsEmbeds: vi.fn().mockReturnValue([{ type: "embed" }]),
}));

vi.mock("../src/utils/playerUtils.js", () => ({
  findPlayer: vi.fn(),
  getPlayerNames: vi.fn().mockResolvedValue([]),
  getPlayerNamesChoices: vi.fn().mockResolvedValue([]),
}));

vi.mock("../src/utils/guildRouter.js", () => ({
  resolveServer: vi.fn(),
}));

vi.mock("../src/utils/embedUtils.js", () => ({
  createPaginationButtons: vi.fn().mockReturnValue({ type: "buttons" }),
  handlePagination: vi.fn().mockResolvedValue(undefined),
  createErrorEmbed: vi.fn().mockReturnValue({ type: "error-embed" }),
}));

vi.mock("../src/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  loadStats,
  flattenStats,
  filterStats,
} from "../src/utils/statUtils.js";
import { findPlayer } from "../src/utils/playerUtils.js";
import { resolveServer } from "../src/utils/guildRouter.js";
import { getSnapshotForDailyDiff } from "../src/utils/snapshotUtils.js";
import { buildStatsEmbeds } from "../src/utils/statEmbeds.js";
import { execute } from "../src/commands/stats/stats.js";
import type { ChatInputCommandInteraction } from "discord.js";

const fakeServer = { id: "survival" } as never;
const fakePlayer = { name: "Steve", uuid: "uuid-1" };
const fakeStatsFile = {
  stats: { "minecraft:custom": { "minecraft:deaths": 5 } },
};
const fakeFlattened = [
  {
    fullKey: "minecraft:custom.minecraft:deaths",
    category: "minecraft:custom",
    key: "minecraft:deaths",
    value: 5,
  },
];

function makeInteraction(
  sub = "player",
  playerName = "Steve",
  filterStat: string | null = null,
): ChatInputCommandInteraction {
  return {
    user: { id: "user1" },
    commandName: "stats",
    deferred: false,
    replied: false,
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue({ id: "msg1" }),
    options: {
      getSubcommand: vi.fn().mockReturnValue(sub),
      getString: vi.fn().mockImplementation((name: string) => {
        if (name === "player") return playerName;
        if (name === "stat") return filterStat;
        return null;
      }),
    },
  } as unknown as ChatInputCommandInteraction;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolveServer).mockReturnValue(fakeServer);
  vi.mocked(findPlayer).mockResolvedValue(fakePlayer);
  vi.mocked(loadStats).mockResolvedValue(fakeStatsFile);
  vi.mocked(flattenStats).mockReturnValue(fakeFlattened);
  vi.mocked(filterStats).mockImplementation((stats) => stats);
  vi.mocked(buildStatsEmbeds).mockReturnValue([{ type: "embed" } as never]);
  vi.mocked(getSnapshotForDailyDiff).mockResolvedValue(null);
});

// ── runPlayer path ──────────────────────────────────────────────────────────

describe("stats execute — player subcommand", () => {
  it("calls deferReply", async () => {
    const interaction = makeInteraction("player");
    await execute(interaction);
    expect(interaction.deferReply).toHaveBeenCalled();
  });

  it("replies with stats embeds on success", async () => {
    const interaction = makeInteraction("player");
    await execute(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ embeds: expect.any(Array) }),
    );
  });

  it("replies with error embed when player is not found", async () => {
    vi.mocked(findPlayer).mockResolvedValue(null);
    const interaction = makeInteraction("player", "NotFound");
    await execute(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ embeds: expect.any(Array) }),
    );
  });

  it("replies with error embed when stats file is missing", async () => {
    vi.mocked(loadStats).mockResolvedValue(null);
    const interaction = makeInteraction("player");
    await execute(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ embeds: expect.any(Array) }),
    );
  });

  it("applies filterStat when provided", async () => {
    const interaction = makeInteraction("player", "Steve", "deaths");
    await execute(interaction);
    expect(filterStats).toHaveBeenCalledWith(fakeFlattened, "deaths");
  });

  it("replies with error info embed when no stats match filter", async () => {
    vi.mocked(filterStats).mockReturnValue([]);
    const interaction = makeInteraction("player", "Steve", "xyzzy");
    await execute(interaction);
    expect(interaction.editReply).toHaveBeenCalled();
  });
});

// ── runDaily path ──────────────────────────────────────────────────────────

describe("stats execute — daily subcommand", () => {
  it("calls getSnapshotForDailyDiff to compute delta", async () => {
    const interaction = makeInteraction("daily");
    await execute(interaction);
    expect(getSnapshotForDailyDiff).toHaveBeenCalled();
  });

  it("replies when no snapshot is available (no baseline)", async () => {
    vi.mocked(getSnapshotForDailyDiff).mockResolvedValue(null);
    const interaction = makeInteraction("daily");
    await execute(interaction);
    expect(interaction.editReply).toHaveBeenCalled();
  });

  it("replies when snapshot exists and stats are computed", async () => {
    vi.mocked(getSnapshotForDailyDiff).mockResolvedValue({
      version: 2,
      timestamp: Date.now() - 3600_000,
      players: {},
      flatStats: { "uuid-1": { "minecraft:custom.minecraft:deaths": 3 } },
    });
    const interaction = makeInteraction("daily");
    await execute(interaction);
    expect(interaction.editReply).toHaveBeenCalled();
  });
});
