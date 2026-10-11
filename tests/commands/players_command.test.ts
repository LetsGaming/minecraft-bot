import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/core/utils/minecraft/statUtils.js", () => ({
  loadAllStats: vi.fn(),
  flattenStats: vi.fn((f: { ticks: number }) => [f]),
  findPlayTimeStat: vi.fn((flat: Array<{ ticks: number }>) => flat[0]!.ticks),
  ticksToMs: vi.fn((n: number) => n * 50),
}));
vi.mock("../../src/core/utils/minecraft/whitelist.js", () => ({
  loadKnownPlayers: vi.fn(),
}));
vi.mock("../../src/core/utils/stores/sessionStore.js", async (orig) => ({
  ...(await orig<typeof import("../../src/core/utils/stores/sessionStore.js")>()),
  loadSessionStore: vi.fn(),
}));
vi.mock("../../src/bot/utils/guild/guildRouter.js", () => ({
  resolveServer: vi.fn(),
}));
vi.mock("../../src/bot/utils/embeds/embedUtils.js", async (orig) => ({
  ...(await orig<typeof import("../../src/bot/utils/embeds/embedUtils.js")>()),
  createPaginationButtons: vi.fn().mockReturnValue({ type: "buttons" }),
  handlePagination: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { loadAllStats } from "../../src/core/utils/minecraft/statUtils.js";
import { loadKnownPlayers } from "../../src/core/utils/minecraft/whitelist.js";
import { loadSessionStore } from "../../src/core/utils/stores/sessionStore.js";
import { resolveServer } from "../../src/bot/utils/guild/guildRouter.js";
import { handlePagination } from "../../src/bot/utils/embeds/embedUtils.js";
import { describeRoster, execute } from "../../src/bot/commands/stats/players.js";
import type { ChatInputCommandInteraction } from "discord.js";

const NOW = Date.now();

function makeInteraction(
  opts: {
    sort?: string | null;
    inactive?: number | null;
    includeUnknown?: boolean | null;
  } = {},
) {
  return {
    user: { id: "u" },
    commandName: "players",
    deferred: false,
    replied: false,
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue({ id: "m" }),
    options: {
      getString: vi.fn((n: string) => (n === "sort" ? (opts.sort ?? null) : null)),
      getInteger: vi.fn(() => opts.inactive ?? null),
      getBoolean: vi.fn(() => opts.includeUnknown ?? null),
    },
  } as unknown as ChatInputCommandInteraction & {
    editReply: ReturnType<typeof vi.fn>;
  };
}

function setup(count: number, sessions = {}) {
  const stats: Record<string, unknown> = {};
  const known = [];
  for (let i = 0; i < count; i++) {
    const uuid = `uuid${String(i).padStart(3, "0")}`;
    stats[uuid] = { ticks: i + 1 };
    known.push({ uuid, name: `P${String(i).padStart(3, "0")}` });
  }
  vi.mocked(loadAllStats).mockResolvedValue(stats as never);
  vi.mocked(loadKnownPlayers).mockResolvedValue(known as never);
  vi.mocked(loadSessionStore).mockResolvedValue({
    version: 1,
    servers: { smp: sessions },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolveServer).mockReturnValue({ id: "smp" } as never);
});

describe("/players", () => {
  it("renders online, last-seen and before-tracking lines", async () => {
    setup(3, {
      p000: { name: "P000", lastSeen: null, sessions: [{ joinedAt: NOW, leftAt: null }] },
      p001: {
        name: "P001",
        lastSeen: NOW - 1000,
        sessions: [{ joinedAt: NOW - 2000, leftAt: NOW - 1000 }],
      },
    });
    const i = makeInteraction();
    await execute(i);
    const desc = i.editReply.mock.calls[0]![0].embeds[0].data.description as string;
    // First line is the summary, then a blank line, then one line per player.
    expect(desc.split("\n")[0]).toBe("1 online, 3 known. Sorted by last seen.");
    const lines = desc.split("\n").slice(2);
    expect(lines[0]).toContain("P000");
    expect(lines[0]).toContain("online now");
    expect(lines[1]).toContain(`<t:${Math.floor((NOW - 1000) / 1000)}:R>`);
    expect(lines[2]).toContain("P002");
    expect(lines[2]).not.toContain("<t:");
  });

  it("shows an empty state", async () => {
    setup(0);
    const i = makeInteraction();
    await execute(i);
    const embed = i.editReply.mock.calls[0]![0].embeds[0];
    expect(embed.data.description).toBeTruthy();
    expect(handlePagination).not.toHaveBeenCalled();
  });

  it("shows an inactive-specific empty state", async () => {
    setup(2);
    const i = makeInteraction({ inactive: 30 });
    await execute(i);
    expect(i.editReply.mock.calls[0]![0].embeds[0].data.description).toContain("30");
  });

  it("paginates at 20 per page", async () => {
    setup(45);
    const i = makeInteraction({ sort: "name" });
    await execute(i);
    expect(handlePagination).toHaveBeenCalledTimes(1);
    const pages = vi.mocked(handlePagination).mock.calls[0]![2];
    expect(pages).toHaveLength(3);
    expect(pages[0]!.data.description!.split("\n").slice(2)).toHaveLength(20);
    expect(pages[2]!.data.description!.split("\n").slice(2)).toHaveLength(5);
    expect(pages[0]!.data.description).toContain("0 online, 45 known. Sorted by name.");
    expect(pages[0]!.data.footer).toBeUndefined();
    expect(i.editReply.mock.calls[0]![0].components).toHaveLength(1);
  });

  it("keeps every page under the embed description limit", async () => {
    setup(40);
    await execute(makeInteraction());
    const pages = vi.mocked(handlePagination).mock.calls[0]![2];
    for (const p of pages) expect(p.data.description!.length).toBeLessThanOrEqual(4096);
  });
});

describe("describeRoster", () => {
  const entry = (online: boolean) => ({
    uuid: null,
    name: "x",
    online,
    lastSeen: null,
    playtimeTicks: null,
  });

  it("counts online and known players and names the sort", () => {
    expect(describeRoster([entry(true), entry(false)], 41, "playtime", null)).toBe(
      "1 online, 41 known. Sorted by playtime.",
    );
  });

  it("counts inactive players under the inactive filter", () => {
    expect(describeRoster([entry(false)], 41, "name", 30)).toBe(
      "1 inactive for more than 30 days, 41 known. Sorted by name.",
    );
  });
});
