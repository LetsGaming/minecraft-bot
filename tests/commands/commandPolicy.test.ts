/**
 * commandPolicy.test.ts — the scoped command-settings resolver:
 * field-by-field merge (scope → global → defaults), enabled-anywhere
 * registration semantics, and the manifest round-trip.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockConfig: {
  commands?: Record<string, { enabled?: boolean; adminOnly?: boolean }>;
  guilds?: Record<
    string,
    { commands?: Record<string, { enabled?: boolean; adminOnly?: boolean }> }
  >;
  servers?: Record<
    string,
    { commands?: Record<string, { enabled?: boolean; adminOnly?: boolean }> }
  >;
} = {};

vi.mock("../../src/core/config.js", () => ({
  loadConfig: vi.fn(() => mockConfig),
}));

vi.mock("../../src/core/utils/jsonStore.js", () => ({
  loadJson: vi.fn(),
  saveJson: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/core/utils/paths.js", () => ({
  getRootDir: vi.fn().mockReturnValue("/tmp"),
}));

import { loadJson, saveJson } from "../../src/core/utils/jsonStore.js";
import {
  resolveCommandPolicy,
  commandEnabledAnywhere,
} from "../../src/core/utils/commands/commandPolicy.js";
import {
  registerManifestCommands,
  flushCommandManifest,
  readCommandManifest,
} from "../../src/core/utils/commands/commandManifest.js";

beforeEach(() => {
  vi.clearAllMocks();
  delete mockConfig.commands;
  delete mockConfig.guilds;
  delete mockConfig.servers;
});

describe("resolveCommandPolicy", () => {
  it("defaults to enabled + not admin-only", () => {
    expect(resolveCommandPolicy("say")).toEqual({
      enabled: true,
      adminOnly: false,
    });
  });

  it("applies the global block", () => {
    mockConfig.commands = { say: { adminOnly: true }, seed: { enabled: false } };
    expect(resolveCommandPolicy("say")).toEqual({
      enabled: true,
      adminOnly: true,
    });
    expect(resolveCommandPolicy("seed").enabled).toBe(false);
  });

  it("merges guild overrides field-by-field over global", () => {
    mockConfig.commands = { say: { adminOnly: true } };
    mockConfig.guilds = {
      g1: { commands: { say: { enabled: false } } },
      g2: { commands: { say: { adminOnly: false } } },
    };
    // g1 sets only `enabled`; adminOnly inherits from global.
    expect(resolveCommandPolicy("say", { guildId: "g1" })).toEqual({
      enabled: false,
      adminOnly: true,
    });
    // g2 relaxes adminOnly (config-level only — built-in gates still run).
    expect(resolveCommandPolicy("say", { guildId: "g2" })).toEqual({
      enabled: true,
      adminOnly: false,
    });
    // Guild without an override → global.
    expect(resolveCommandPolicy("say", { guildId: "g3" })).toEqual({
      enabled: true,
      adminOnly: true,
    });
  });

  it("merges server overrides for in-game scope", () => {
    mockConfig.commands = { slime: { enabled: false } };
    mockConfig.servers = {
      creative: { commands: { slime: { enabled: true } } },
    };
    expect(resolveCommandPolicy("slime", { serverId: "creative" }).enabled).toBe(
      true,
    );
    expect(resolveCommandPolicy("slime", { serverId: "smp" }).enabled).toBe(
      false,
    );
  });
});

describe("commandEnabledAnywhere", () => {
  it("true by default and when globally enabled", () => {
    expect(commandEnabledAnywhere("say")).toBe(true);
  });

  it("false only when disabled globally with no scope enabling it", () => {
    mockConfig.commands = { seed: { enabled: false } };
    expect(commandEnabledAnywhere("seed")).toBe(false);

    mockConfig.guilds = { g1: { commands: { seed: { enabled: true } } } };
    expect(commandEnabledAnywhere("seed")).toBe(true);

    delete mockConfig.guilds;
    mockConfig.servers = { smp: { commands: { seed: { enabled: true } } } };
    expect(commandEnabledAnywhere("seed")).toBe(true);
  });
});

describe("command manifest", () => {
  it("dedupes, sorts, and round-trips", async () => {
    registerManifestCommands("slash", [
      { name: "zeta", description: "z" },
      { name: "alpha", description: "old" },
      { name: "alpha", description: "new" }, // last write wins
    ]);
    registerManifestCommands("ingame", [{ name: "vote", description: "v" }]);
    await flushCommandManifest();

    const written = vi.mocked(saveJson).mock.calls[0]![1] as {
      slash: Array<{ name: string; description: string }>;
      ingame: Array<{ name: string }>;
    };
    expect(written.slash.map((c) => c.name)).toEqual(["alpha", "zeta"]);
    expect(written.slash[0]!.description).toBe("new");
    expect(written.ingame.map((c) => c.name)).toEqual(["vote"]);

    vi.mocked(loadJson).mockResolvedValue(written as never);
    const read = await readCommandManifest();
    expect(read?.slash).toHaveLength(2);
  });

  it("readCommandManifest returns null when the bot never wrote one", async () => {
    vi.mocked(loadJson).mockRejectedValue(new Error("missing"));
    expect(await readCommandManifest()).toBeNull();
  });
});
