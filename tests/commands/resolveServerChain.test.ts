import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/core/config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/core/config.js")>()),
  loadConfig: vi.fn(),
}));

import { loadConfig } from "../../src/core/config.js";
import {
  initServers,
  getAllInstances,
  removeServerInstance,
} from "../../src/core/utils/server/server.js";
import { resolveServer } from "../../src/bot/utils/guild/guildRouter.js";
import type { BotConfig } from "../../src/core/types/index.js";
import type { ChatInputCommandInteraction } from "discord.js";

function serverCfg(id: string) {
  return {
    id,
    serverDir: "/tmp",
    linuxUser: "mc",
    screenSession: "server",
    useRcon: false,
    rconHost: "localhost",
    rconPort: 25575,
    rconPassword: "",
    scriptDir: "",
  };
}

function interaction(opts: {
  server?: string | null;
  guildId?: string | null;
  userId?: string;
}): ChatInputCommandInteraction {
  return {
    guild: opts.guildId != null ? { id: opts.guildId } : null,
    user: { id: opts.userId ?? "user" },
    options: { getString: () => opts.server ?? null },
  } as unknown as ChatInputCommandInteraction;
}

function setup(serverIds: string[], guilds: BotConfig["guilds"]): void {
  const servers = Object.fromEntries(serverIds.map((id) => [id, serverCfg(id)]));
  const cfg = { adminUsers: [], guilds, servers } as unknown as BotConfig;
  vi.mocked(loadConfig).mockReturnValue(cfg);
  initServers(servers as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const inst of getAllInstances()) removeServerInstance(inst.id);
});

describe("resolveServer through the real chain", () => {
  it("uses the explicit option", () => {
    setup(["a", "b"], { g1: { defaultServer: "a" } } as never);
    expect(resolveServer(interaction({ server: "b", guildId: "g1" })).id).toBe("b");
  });

  it("rejects an explicit unknown server", () => {
    setup(["a"], { g1: { defaultServer: "a" } } as never);
    expect(() => resolveServer(interaction({ server: "zzz", guildId: "g1" }))).toThrow(
      /not found/,
    );
  });

  it("uses a valid defaultServer", () => {
    setup(["a", "b"], { g1: { defaultServer: "b" } } as never);
    expect(resolveServer(interaction({ guildId: "g1" })).id).toBe("b");
  });

  it("handles a stale defaultServer", () => {
    setup(["a", "b"], { g1: { defaultServer: "gone" } } as never);
    expect(resolveServer(interaction({ guildId: "g1" })).id).toBe("a");
  });

  it("handles a single-tenant guild without a default", () => {
    setup(["a"], { g1: {} } as never);
    expect(resolveServer(interaction({ guildId: "g1" })).id).toBe("a");
  });

  it("handles a multi-guild tenant with exactly one allowed server and no default", () => {
    setup(["a", "b"], {
      g1: { allowedServers: ["b"] },
      g2: { allowedServers: ["a"] },
    } as never);
    expect(() => resolveServer(interaction({ guildId: "g1" }))).toThrow(
      /not available/,
    );
  });

  it("handles a DM with one configured server", () => {
    setup(["a"], { g1: { defaultServer: "a" } } as never);
    expect(() => resolveServer(interaction({ guildId: null }))).toThrow(
      /No server configured/,
    );
  });

  it("handles a DM with several servers", () => {
    setup(["a", "b"], { g1: { defaultServer: "a" } } as never);
    expect(() => resolveServer(interaction({ guildId: null }))).toThrow(
      /No server configured/,
    );
  });

  it("blocks a tenant from targeting another tenant's server explicitly", () => {
    setup(["a", "b"], {
      g1: { defaultServer: "a" },
      g2: { defaultServer: "b" },
    } as never);
    expect(() => resolveServer(interaction({ server: "b", guildId: "g1" }))).toThrow(
      /not available/,
    );
    expect(resolveServer(interaction({ guildId: "g2" })).id).toBe("b");
  });

  it("throws when no servers are registered", () => {
    setup([], { g1: {} } as never);
    expect(() => resolveServer(interaction({ guildId: "g1" }))).toThrow(
      /No server configured/,
    );
  });
});
