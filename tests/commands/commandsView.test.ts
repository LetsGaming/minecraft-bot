import { describe, it, expect } from "vitest";
import {
  buildCommandsView,
  summariseUsage,
  type CommandsViewDeps,
} from "../../src/core/utils/commands/commandsView.js";
import type { CommandManifest } from "../../src/core/utils/commands/commandManifest.js";
import type { CommandUsageCount } from "../../src/core/utils/commands/commandUsage.js";
import type { RawBotConfig } from "../../src/core/types/index.js";

const manifest: CommandManifest = {
  slash: [{ name: "stats", description: "Player stats" }],
  ingame: [{ name: "rank", description: "Your rank" }],
  updatedAt: 1,
};

const raw = {
  commands: { stats: { enabled: false } },
  guilds: { g1: { commands: { stats: { adminOnly: true } } }, g2: {} },
  servers: { smp: {} },
} as unknown as RawBotConfig;

function row(partial: Partial<CommandUsageCount> & { command: string }): CommandUsageCount {
  return { surface: "slash", count: 0, users: 0, lastUsedAt: null, ...partial };
}

describe("summariseUsage", () => {
  it("folds both surfaces of one command: summed uses, larger user count, latest use", () => {
    const out = summariseUsage([
      row({ command: "stats", surface: "slash", count: 3, users: 2, lastUsedAt: 100 }),
      row({ command: "stats", surface: "ingame", count: 4, users: 5, lastUsedAt: 50 }),
      row({ command: "rank", count: 1, users: 1, lastUsedAt: null }),
    ]);
    expect(out.stats).toEqual({ count: 7, users: 5, lastUsedAt: 100 });
    expect(out.rank).toEqual({ count: 1, users: 1, lastUsedAt: null });
  });
});

describe("buildCommandsView", () => {
  const deps: CommandsViewDeps = {
    resolvePolicy: (name, scope = {}) => ({
      enabled: name !== "stats" || scope.guildId !== "g2",
      adminOnly: scope.serverId === "smp",
    }),
    usage: () => [row({ command: "stats", count: 2, users: 1, lastUsedAt: 9 })],
  };

  it("lists the scopes from the config and the overrides at each of them", () => {
    const view = buildCommandsView({ manifest, raw, hash: "h1" }, deps);
    expect(view.hash).toBe("h1");
    expect(view.scopes).toEqual({ guildIds: ["g1", "g2"], serverIds: ["smp"] });
    expect(view.overrides.global).toEqual({ stats: { enabled: false } });
    expect(view.overrides.guilds).toEqual({ g1: { stats: { adminOnly: true } }, g2: {} });
    expect(view.overrides.servers).toEqual({ smp: {} });
  });

  it("resolves the effective policy for every command at every scope", () => {
    const view = buildCommandsView({ manifest, raw, hash: "h" }, deps);
    expect(Object.keys(view.effective).sort()).toEqual(["rank", "stats"]);
    expect(Object.keys(view.effective.stats!).sort()).toEqual([
      "global",
      "guild:g1",
      "guild:g2",
      "server:smp",
    ]);
    expect(view.effective.stats!["guild:g2"]).toEqual({ enabled: false, adminOnly: false });
    expect(view.effective.rank!["server:smp"]).toEqual({ enabled: true, adminOnly: true });
  });

  it("carries the usage summary and its window", () => {
    const view = buildCommandsView({ manifest, raw, hash: "h" }, deps);
    expect(view.usage.byCommand.stats).toEqual({ count: 2, users: 1, lastUsedAt: 9 });
    expect(view.usage.windowDays).toBeGreaterThan(0);
  });

  it("tolerates a config without guilds, servers or overrides", () => {
    const view = buildCommandsView(
      { manifest, raw: {} as RawBotConfig, hash: "h" },
      { resolvePolicy: () => ({ enabled: true, adminOnly: false }), usage: () => [] },
    );
    expect(view.scopes).toEqual({ guildIds: [], serverIds: [] });
    expect(view.overrides).toEqual({ global: {}, guilds: {}, servers: {} });
    expect(Object.keys(view.effective.stats!)).toEqual(["global"]);
  });
});
