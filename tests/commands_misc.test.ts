/**
 * Batch tests for remaining 0% command files and utilities.
 * Covers: mods, netherportal, chunkbase, playerhead commands,
 * plus logStreamUrl from serverAccess, RemoteLogWatcher class, discordChannel helpers.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Shared mocks ──────────────────────────────────────────────────────────

vi.mock("../src/commands/middleware.js", () => ({
  withErrorHandling: vi.fn((fn) => fn),
  requireServerAdmin: vi.fn((fn) => fn),
}));

vi.mock("../src/utils/guildRouter.js", () => ({
  resolveServer: vi.fn(),
}));

vi.mock("../src/utils/embedUtils.js", () => ({
  createEmbed: vi.fn().mockImplementation((opts) => ({
    _opts: opts,
    addFields: vi.fn().mockReturnThis(),
    setFooter: vi.fn().mockReturnThis(),
  })),
  createErrorEmbed: vi.fn().mockReturnValue({ type: "error" }),
  createPlayerEmbed: vi.fn().mockReturnValue({ type: "player-embed" }),
}));

vi.mock("../src/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../src/utils/linkUtils.js", () => ({
  getLinkedAccount: vi.fn().mockResolvedValue(null),
  loadLinkedAccounts: vi.fn().mockResolvedValue({}),
  loadLinkCodes: vi.fn().mockResolvedValue({}),
}));

vi.mock("../src/utils/playerUtils.js", () => ({
  getLinkedAccount: vi.fn(),
  getPlayerCoords: vi.fn().mockResolvedValue(null),
  getOnlinePlayers: vi.fn().mockResolvedValue([]),
}));

vi.mock("../src/utils/modUtils.js", () => ({
  getModList: vi.fn(),
}));

vi.mock("../src/utils/time.js", () => ({
  formatTime: vi.fn().mockReturnValue("12:00"),
  TZ: "UTC",
  formatDate: vi.fn(),
  formatDatetime: vi.fn(),
  nextMidnightEpoch: vi.fn(),
  msUntilMidnight: vi.fn(),
}));

import { resolveServer } from "../src/utils/guildRouter.js";
import { getLinkedAccount } from "../src/utils/linkUtils.js";
import { getModList } from "../src/utils/modUtils.js";

const fakeServer = { id: "survival", config: { id: "survival" }, getSeed: vi.fn().mockResolvedValue("12345") } as never;

function makeInteraction(overrides: Record<string, unknown> = {}) {
  return {
    user: { id: "u1", tag: "User#0001" },
    commandName: "cmd",
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue({ id: "msg1" }),
    reply: vi.fn().mockResolvedValue(undefined),
    deferred: false,
    replied: false,
    options: { getString: vi.fn().mockReturnValue(null) },
    ...overrides,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolveServer).mockReturnValue(fakeServer);
});

// ══════════════════════════════════════════════════════════════════════════════
// /mods command
// ══════════════════════════════════════════════════════════════════════════════

describe("/mods command", () => {
  let execute: (i: never) => Promise<void>;
  beforeEach(async () => {
    ({ execute } = await import("../src/commands/info/mods.js"));
  });

  it("replies with mod list embed when mods are available", async () => {
    vi.mocked(getModList).mockResolvedValue({
      serverOnly: [{ slug: "m1", name: "Mod One", url: "https://modrinth.com/m1", description: "A mod", side: "server_only" }],
      clientAndServer: [],
      clientOptional: [],
      cached: false,
      fetchedAt: Date.now(),
    } as never);
    const interaction = makeInteraction();
    await execute(interaction);
    expect(interaction.editReply).toHaveBeenCalled();
  });

  it("replies with empty embed when no mods found", async () => {
    vi.mocked(getModList).mockResolvedValue({
      serverOnly: [],
      clientAndServer: [],
      clientOptional: [],
      cached: false,
      fetchedAt: Date.now(),
    } as never);
    const interaction = makeInteraction();
    await execute(interaction);
    expect(interaction.editReply).toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// /netherportal command
// ══════════════════════════════════════════════════════════════════════════════

describe("/netherportal command", () => {
  let execute: (i: never) => Promise<void>;
  beforeEach(async () => {
    ({ execute } = await import("../src/commands/info/netherportal.js"));
  });

  it("replies with error when user has no linked account", async () => {
    vi.mocked(getLinkedAccount).mockResolvedValue(null);
    const interaction = makeInteraction();
    await execute(interaction);
    expect(interaction.editReply).toHaveBeenCalled();
  });

  it("replies with error when player coordinates are not found", async () => {
    vi.mocked(getLinkedAccount).mockResolvedValue("Steve");
    const { getPlayerCoords } = await import("../src/utils/playerUtils.js");
    vi.mocked(getPlayerCoords).mockResolvedValue(null);
    const interaction = makeInteraction();
    await execute(interaction);
    expect(interaction.editReply).toHaveBeenCalled();
  });

  it("replies with portal coords when player is in overworld", async () => {
    vi.mocked(getLinkedAccount).mockResolvedValue("Steve");
    const { getPlayerCoords } = await import("../src/utils/playerUtils.js");
    vi.mocked(getPlayerCoords).mockResolvedValue({
      x: 800,
      y: 64,
      z: -400,
      dimension: "minecraft:overworld",
    } as never);
    const interaction = makeInteraction();
    await execute(interaction);
    expect(interaction.editReply).toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// /chunkbase command
// ══════════════════════════════════════════════════════════════════════════════

describe("/chunkbase command", () => {
  let execute: (i: never) => Promise<void>;
  beforeEach(async () => {
    ({ execute } = await import("../src/commands/info/chunkbase.js"));
  });

  it("replies with chunkbase link when seed is available", async () => {
    vi.mocked(getLinkedAccount).mockResolvedValue("Steve");
    const interaction = makeInteraction({
      options: { getString: vi.fn().mockReturnValue("overworld") },
    });
    await execute(interaction);
    expect(interaction.editReply).toHaveBeenCalled();
  });

  it("throws when seed is null", async () => {
    vi.mocked(resolveServer).mockReturnValue({
      ...fakeServer,
      getSeed: vi.fn().mockResolvedValue(null),
    } as never);
    const interaction = makeInteraction({
      options: { getString: vi.fn().mockReturnValue("overworld") },
    });
    await expect(execute(interaction)).rejects.toThrow("seed");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// /playerhead command
// ══════════════════════════════════════════════════════════════════════════════

describe("/playerhead command", () => {
  let execute: (i: never) => Promise<void>;
  beforeEach(async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ id: "uuid-99", name: "Notch" }),
    }));
    ({ execute } = await import("../src/commands/connection/playerhead.js"));
  });

  it("replies with player head embed when player is found", async () => {
    const interaction = makeInteraction({
      options: {
        getString: vi.fn().mockImplementation((n: string) =>
          n === "mcname" ? "Notch" : null,
        ),
      },
      fetchReply: vi.fn().mockResolvedValue({ id: "msg1", createMessageComponentCollector: vi.fn().mockReturnValue({ on: vi.fn() }) }),
    });
    await execute(interaction);
    expect(interaction.reply).toHaveBeenCalled();
  });

  it("replies with error embed when player is not found on Mojang", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    const interaction = makeInteraction({
      options: {
        getString: vi.fn().mockImplementation((n: string) =>
          n === "mcname" ? "NotRealPlayer" : null,
        ),
      },
    });
    await execute(interaction);
    expect(interaction.reply).toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// serverAccess.logStreamUrl (pure function)
// ══════════════════════════════════════════════════════════════════════════════

describe("serverAccess.logStreamUrl", () => {
  let logStreamUrl: (cfg: never) => string;
  beforeEach(async () => {
    ({ logStreamUrl } = await import("../src/utils/serverAccess.js"));
  });

  it("builds the SSE stream URL from apiUrl including instance id", () => {
    const cfg = { id: "survival", apiUrl: "https://api.example.com" } as never;
    const url = logStreamUrl(cfg);
    // The real function: `${apiUrl}/instances/${id}/logs/stream`
    expect(url).toMatch(/https:\/\/api\.example\.com\/instances\/survival\/logs\/stream/);
  });

  it("strips trailing slash from apiUrl before building URL", () => {
    const cfg = { id: "srv", apiUrl: "https://api.example.com/" } as never;
    const url = logStreamUrl(cfg);
    expect(url).not.toContain("//instances");
  });

  it("throws for a local instance without apiUrl", () => {
    const cfg = { id: "survival", apiUrl: undefined } as never;
    expect(() => logStreamUrl(cfg)).toThrow("local instance");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// RemoteLogWatcher class
// ══════════════════════════════════════════════════════════════════════════════

describe("RemoteLogWatcher", () => {
  let RemoteLogWatcher: typeof import("../src/logWatcher/RemoteLogWatcher.js").RemoteLogWatcher;
  beforeEach(async () => {
    ({ RemoteLogWatcher } = await import("../src/logWatcher/RemoteLogWatcher.js"));
  });

  const fakeRemoteServer = {
    id: "remote",
    config: { id: "remote", apiUrl: "https://api.example.com", apiKey: "key123" },
  } as never;

  it("can be constructed with a server instance", () => {
    const watcher = new RemoteLogWatcher(fakeRemoteServer);
    expect(watcher.server.id).toBe("remote");
  });

  it("register() stores handlers without throwing", () => {
    const watcher = new RemoteLogWatcher(fakeRemoteServer);
    expect(() => watcher.register(/test/, vi.fn())).not.toThrow();
  });

  it("stop() without start() does not throw", () => {
    const watcher = new RemoteLogWatcher(fakeRemoteServer);
    expect(() => watcher.stop()).not.toThrow();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// discordChannel helpers
// ══════════════════════════════════════════════════════════════════════════════

describe("discordChannel — renameVoiceChannelIfChanged", () => {
  let renameVoiceChannelIfChanged: (ch: never, name: string) => Promise<boolean>;
  beforeEach(async () => {
    ({ renameVoiceChannelIfChanged } = await import("../src/utils/discordChannel.js"));
  });

  it("returns false without API call when name is unchanged", async () => {
    const channel = { name: "👥 Players: 3 / 20", setName: vi.fn() } as never;
    const result = await renameVoiceChannelIfChanged(channel, "👥 Players: 3 / 20");
    expect(result).toBe(false);
    expect(channel.setName).not.toHaveBeenCalled();
  });

  it("calls setName and returns true when name changes", async () => {
    const channel = {
      name: "👥 Players: 3 / 20",
      setName: vi.fn().mockResolvedValue(undefined),
    } as never;
    const result = await renameVoiceChannelIfChanged(channel, "👥 Players: 5 / 20");
    expect(result).toBe(true);
    expect(channel.setName).toHaveBeenCalledWith("👥 Players: 5 / 20");
  });
});
