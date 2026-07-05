/**
 * resolveGuildBridges — the strict 1:1 bridge model.
 *
 * One Discord channel is bound to exactly one server, both directions:
 *   - explicit `server` pin wins
 *   - otherwise the guild's defaultServer
 *   - otherwise the sole configured server
 *   - otherwise it's a problem (skipped + reported)
 * A channel bound to two different servers is always a problem.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("../src/common/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../src/bot/utils/embedUtils.js", () => ({
  createPlayerEmbed: vi.fn().mockReturnValue({}),
}));

import { resolveGuildBridges } from "../src/bot/logWatcher/watchers/chatBridge.js";
import type { GuildConfig } from "../src/common/types/index.js";

const gc = (partial: Partial<GuildConfig>): GuildConfig => partial;

describe("resolveGuildBridges", () => {
  it("binds a pinned bridge to its server", () => {
    const { bridges, problems } = resolveGuildBridges(
      gc({ chatBridge: { channelId: "ch1", server: "creative" } }),
      ["survival", "creative"],
    );
    expect(problems).toHaveLength(0);
    expect(bridges).toEqual([{ channelId: "ch1", serverId: "creative" }]);
  });

  it("falls back to the guild defaultServer when unpinned", () => {
    const { bridges, problems } = resolveGuildBridges(
      gc({ defaultServer: "survival", chatBridge: { channelId: "ch1" } }),
      ["survival", "creative"],
    );
    expect(problems).toHaveLength(0);
    expect(bridges).toEqual([{ channelId: "ch1", serverId: "survival" }]);
  });

  it("binds to the sole configured server when nothing else is set", () => {
    const { bridges, problems } = resolveGuildBridges(
      gc({ chatBridge: { channelId: "ch1" } }),
      ["only"],
    );
    expect(problems).toHaveLength(0);
    expect(bridges).toEqual([{ channelId: "ch1", serverId: "only" }]);
  });

  it("reports an ambiguous bridge instead of guessing", () => {
    const { bridges, problems } = resolveGuildBridges(
      gc({ chatBridge: { channelId: "ch1" } }),
      ["survival", "creative"],
    );
    expect(bridges).toHaveLength(0);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("exactly one server");
  });

  it("resolves an array into one bridge per channel/server pair", () => {
    const { bridges, problems } = resolveGuildBridges(
      gc({
        chatBridge: [
          { channelId: "ch1", server: "survival" },
          { channelId: "ch2", server: "creative" },
        ],
      }),
      ["survival", "creative"],
    );
    expect(problems).toHaveLength(0);
    expect(bridges).toEqual([
      { channelId: "ch1", serverId: "survival" },
      { channelId: "ch2", serverId: "creative" },
    ]);
  });

  it("rejects one channel bound to two different servers", () => {
    const { bridges, problems } = resolveGuildBridges(
      gc({
        chatBridge: [
          { channelId: "ch1", server: "survival" },
          { channelId: "ch1", server: "creative" },
        ],
      }),
      ["survival", "creative"],
    );
    expect(bridges).toEqual([{ channelId: "ch1", serverId: "survival" }]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('"survival"');
    expect(problems[0]).toContain('"creative"');
  });

  it("dedupes identical bindings silently", () => {
    const { bridges, problems } = resolveGuildBridges(
      gc({
        chatBridge: [
          { channelId: "ch1", server: "survival" },
          { channelId: "ch1", server: "survival" },
        ],
      }),
      ["survival", "creative"],
    );
    expect(problems).toHaveLength(0);
    expect(bridges).toHaveLength(1);
  });

  it("ignores entries without a channelId and handles missing config", () => {
    expect(
      resolveGuildBridges(gc({ chatBridge: { server: "survival" } }), [
        "survival",
      ]).bridges,
    ).toHaveLength(0);
    expect(resolveGuildBridges(gc({}), ["survival"]).bridges).toHaveLength(0);
  });
});
