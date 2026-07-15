import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock server + config modules ────────────────────────────────────────────
vi.mock("../../src/core/utils/server/server.js", () => ({
  getServerInstance: vi.fn(),
  getGuildServer: vi.fn(),
}));

vi.mock("../../src/core/config.js", () => ({
  loadConfig: vi.fn(),
}));

import { getServerInstance, getGuildServer } from "../../src/core/utils/server/server.js";
import { loadConfig } from "../../src/core/config.js";
import {
  resolveServer,
  tryResolveServer,
  getAllowedServerIds,
  serverInScope,
} from "../../src/bot/utils/guild/guildRouter.js";
import type { BotConfig } from "../../src/core/types/index.js";
import type { ChatInputCommandInteraction } from "discord.js";

// Minimal interaction stub
function makeInteraction(opts: {
  serverId?: string | null;
  guildId?: string | null;
  userId?: string;
}): ChatInputCommandInteraction {
  return {
    guild: opts.guildId != null ? { id: opts.guildId } : null,
    user: { id: opts.userId ?? "user_default" },
    options: {
      getString: (_name: string) => opts.serverId ?? null,
    },
  } as unknown as ChatInputCommandInteraction;
}

function mockConfig(partial: Partial<BotConfig>): void {
  vi.mocked(loadConfig).mockReturnValue({
    adminUsers: [],
    guilds: {},
    servers: {},
    ...partial,
  } as BotConfig);
}

const fakeServer = { id: "main", useRcon: false } as never;
const otherServer = { id: "survival", useRcon: true } as never;

beforeEach(() => {
  vi.clearAllMocks();
  // Default: single-tenant config → no tenant restrictions.
  mockConfig({ guilds: { guild1: { defaultServer: "main" } } });
});

describe("resolveServer", () => {
  it("uses explicit server option when provided", () => {
    vi.mocked(getServerInstance).mockReturnValue(fakeServer);
    const interaction = makeInteraction({
      serverId: "main",
      guildId: "guild1",
    });
    const result = resolveServer(interaction);
    expect(getServerInstance).toHaveBeenCalledWith("main");
    expect(result).toBe(fakeServer);
  });

  it("falls back to guild default when no explicit server option", () => {
    vi.mocked(getGuildServer).mockReturnValue(fakeServer);
    const interaction = makeInteraction({ serverId: null, guildId: "guild1" });
    const result = resolveServer(interaction);
    expect(getGuildServer).toHaveBeenCalledWith("guild1");
    expect(result).toBe(fakeServer);
  });

  it("throws when explicit server ID is not found", () => {
    vi.mocked(getServerInstance).mockReturnValue(null);
    const interaction = makeInteraction({
      serverId: "unknown",
      guildId: "guild1",
    });
    expect(() => resolveServer(interaction)).toThrow(
      'Server "unknown" not found.',
    );
  });

  it("throws when guild has no configured server", () => {
    vi.mocked(getGuildServer).mockReturnValue(null);
    const interaction = makeInteraction({ serverId: null, guildId: "guild1" });
    expect(() => resolveServer(interaction)).toThrow(
      "No server configured for this guild.",
    );
  });

  it("returns different server per explicit ID", () => {
    vi.mocked(getServerInstance).mockImplementation((id) =>
      id === "survival" ? otherServer : null,
    );
    const interaction = makeInteraction({
      serverId: "survival",
      guildId: "guild1",
    });
    expect(resolveServer(interaction)).toBe(otherServer);
  });
});

describe("tryResolveServer", () => {
  it("returns server when found", () => {
    vi.mocked(getGuildServer).mockReturnValue(fakeServer);
    const interaction = makeInteraction({ serverId: null, guildId: "guild1" });
    expect(tryResolveServer(interaction)).toBe(fakeServer);
  });

  it("returns null instead of throwing when not found", () => {
    vi.mocked(getGuildServer).mockReturnValue(null);
    const interaction = makeInteraction({ serverId: null, guildId: "guild1" });
    expect(tryResolveServer(interaction)).toBeNull();
  });
});

// ── Tenant isolation in multi-guild deployments ─────────────────────────────

const multiGuildConfig = {
  adminUsers: ["operator1"],
  guilds: {
    guildA: { defaultServer: "main" },
    guildB: { defaultServer: "survival" },
  },
} as Partial<BotConfig>;

describe("resolveServer tenant isolation", () => {
  beforeEach(() => {
    mockConfig(multiGuildConfig);
    vi.mocked(getServerInstance).mockImplementation((id) =>
      id === "survival" ? otherServer : id === "main" ? fakeServer : null,
    );
  });

  it("blocks explicit cross-guild targeting for regular users", () => {
    // guildA's allowed set derives to {main} — targeting guildB's server
    // must fail even though the instance exists.
    const interaction = makeInteraction({
      serverId: "survival",
      guildId: "guildA",
      userId: "someMember",
    });
    expect(() => resolveServer(interaction)).toThrow(
      /not available from this Discord server/,
    );
  });

  it("allows a guild to target its own server explicitly", () => {
    const interaction = makeInteraction({
      serverId: "main",
      guildId: "guildA",
      userId: "someMember",
    });
    expect(resolveServer(interaction)).toBe(fakeServer);
  });

  it("lets global admins (operators) target any server from any guild", () => {
    const interaction = makeInteraction({
      serverId: "survival",
      guildId: "guildA",
      userId: "operator1",
    });
    expect(resolveServer(interaction)).toBe(otherServer);
  });

  it("per-guild admins are NOT exempt from server scoping", () => {
    mockConfig({
      adminUsers: [],
      guilds: {
        guildA: { defaultServer: "main", adminUsers: ["guildAAdmin"] },
        guildB: { defaultServer: "survival" },
      },
    });
    const interaction = makeInteraction({
      serverId: "survival",
      guildId: "guildA",
      userId: "guildAAdmin",
    });
    expect(() => resolveServer(interaction)).toThrow(
      /not available from this Discord server/,
    );
  });

  it("honours an explicit allowedServers list", () => {
    mockConfig({
      adminUsers: [],
      guilds: {
        guildA: { defaultServer: "main", allowedServers: ["survival"] },
        guildB: { defaultServer: "survival" },
      },
    });
    const interaction = makeInteraction({
      serverId: "survival",
      guildId: "guildA",
      userId: "someMember",
    });
    expect(resolveServer(interaction)).toBe(otherServer);
  });

  it("blocks unconfigured guilds in multi-guild deployments", () => {
    vi.mocked(getGuildServer).mockReturnValue(fakeServer); // first-instance fallback
    const interaction = makeInteraction({
      serverId: null,
      guildId: "strangerGuild",
      userId: "someMember",
    });
    expect(() => resolveServer(interaction)).toThrow(
      /not available from this Discord server/,
    );
  });

  it("blocks explicit targeting from DMs for non-operators", () => {
    const interaction = makeInteraction({
      serverId: "survival",
      guildId: null,
      userId: "someMember",
    });
    expect(() => resolveServer(interaction)).toThrow(
      /must be used inside a Discord server/,
    );
  });

  it("allows explicit targeting from DMs for global admins", () => {
    const interaction = makeInteraction({
      serverId: "survival",
      guildId: null,
      userId: "operator1",
    });
    expect(resolveServer(interaction)).toBe(otherServer);
  });

  it("does not restrict single-guild deployments (legacy behaviour)", () => {
    mockConfig({ guilds: { onlyGuild: { defaultServer: "main" } } });
    const interaction = makeInteraction({
      serverId: "survival",
      guildId: "onlyGuild",
      userId: "someMember",
    });
    expect(resolveServer(interaction)).toBe(otherServer);
  });
});

describe("getAllowedServerIds", () => {
  it("returns null (unrestricted) for single-tenant configs", () => {
    mockConfig({ guilds: { g1: { defaultServer: "main" } } });
    expect(getAllowedServerIds("g1")).toBeNull();
  });

  it("derives the set from referenced servers when allowedServers is unset", () => {
    mockConfig({
      guilds: {
        g1: {
          defaultServer: "main",
          chatBridge: { channelId: "c", server: "events" },
        },
        g2: { defaultServer: "survival" },
      },
    });
    expect([...getAllowedServerIds("g1")!].sort()).toEqual([
      "events",
      "main",
    ]);
  });

  it("always includes defaultServer even with an explicit allowedServers list", () => {
    mockConfig({
      guilds: {
        g1: { defaultServer: "main", allowedServers: ["survival"] },
        g2: { defaultServer: "survival" },
      },
    });
    const allowed = getAllowedServerIds("g1")!;
    expect(allowed.has("main")).toBe(true);
    expect(allowed.has("survival")).toBe(true);
  });

  it("returns an empty set for DMs and unconfigured guilds when multi-tenant", () => {
    mockConfig(multiGuildConfig);
    expect(getAllowedServerIds(undefined)?.size).toBe(0);
    expect(getAllowedServerIds("unknownGuild")?.size).toBe(0);
  });

  it("stays unrestricted for a configured guild that references no servers", () => {
    mockConfig({
      guilds: {
        g1: {},
        g2: { defaultServer: "survival" },
      },
    });
    expect(getAllowedServerIds("g1")).toBeNull();
  });
});

// ── serverInScope — push-feature scoping ────────────────────────────────────

describe("serverInScope", () => {
  it("matches a string scope by exact ID", () => {
    expect(serverInScope("survival", "survival", "guild1")).toBe(true);
    expect(serverInScope("survival", "creative", "guild1")).toBe(false);
  });

  it("matches a list scope by membership", () => {
    expect(serverInScope(["a", "b"], "b", "guild1")).toBe(true);
    expect(serverInScope(["a", "b"], "c", "guild1")).toBe(false);
    expect(serverInScope([], "a", "guild1")).toBe(false);
  });

  it("unset scope = every server in single-guild deployments", () => {
    mockConfig({ guilds: { guild1: { defaultServer: "main" } } });
    expect(serverInScope(undefined, "main", "guild1")).toBe(true);
    expect(serverInScope(undefined, "anything", "guild1")).toBe(true);
  });

  it("unset scope = only the guild's servers in multi-guild deployments", () => {
    mockConfig({
      guilds: {
        guild1: { defaultServer: "main" },
        guild2: { defaultServer: "survival" },
      },
    });
    // guild1 sees its own server…
    expect(serverInScope(undefined, "main", "guild1")).toBe(true);
    // …but never the other tenant's — the old "unpinned receives all
    // servers" leak is closed.
    expect(serverInScope(undefined, "survival", "guild1")).toBe(false);
  });

  it("explicit allowedServers wins over derived references", () => {
    mockConfig({
      guilds: {
        guild1: { defaultServer: "main", allowedServers: ["main", "extra"] },
        guild2: { defaultServer: "survival" },
      },
    });
    expect(serverInScope(undefined, "extra", "guild1")).toBe(true);
    expect(serverInScope(undefined, "survival", "guild1")).toBe(false);
  });
});
