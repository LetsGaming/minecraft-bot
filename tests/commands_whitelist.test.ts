/**
 * Batch tests for whitelist management commands and misc commands:
 * whitelist, unwhitelist, verify, whitelisted, clear, map
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/bot/commands/middleware.js", () => ({
  withErrorHandling: vi.fn((fn) => fn),
  requireServerAdmin: vi.fn((fn) => fn),
  isServerAdmin: vi.fn().mockReturnValue(true),
}));

vi.mock("../src/bot/utils/guildRouter.js", () => ({
  resolveServer: vi.fn(),
}));

vi.mock("../src/bot/utils/embedUtils.js", () => ({
  createEmbed: vi.fn().mockImplementation((opts) => ({
    _opts: opts,
    addFields: vi.fn().mockReturnThis(),
    setFooter: vi.fn().mockReturnThis(),
    toJSON: () => ({ title: opts?.title }),
  })),
  createErrorEmbed: vi.fn().mockReturnValue({ type: "error-embed" }),
  createSuccessEmbed: vi.fn().mockReturnValue({ type: "success-embed" }),
  createPaginationButtons: vi.fn().mockReturnValue({ type: "buttons" }),
  handlePagination: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../src/common/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../src/common/utils/whitelistAudit.js", () => ({
  recordAdd: vi.fn().mockResolvedValue(undefined),
  recordRemove: vi.fn().mockResolvedValue(undefined),
  getAuditEntry: vi.fn().mockResolvedValue(null),
  loadAudit: vi.fn().mockResolvedValue({}),
}));

vi.mock("../src/common/utils/utils.js", () => ({
  getRootDir: vi.fn().mockReturnValue("/tmp"),
  loadJson: vi.fn().mockResolvedValue({}),
  loadWhitelist: vi.fn().mockResolvedValue([
    { name: "Alice", uuid: "uuid-1" },
    { name: "Bob", uuid: "uuid-2" },
  ]),
  loadKnownPlayers: vi.fn().mockResolvedValue([
    { name: "Alice", uuid: "uuid-1" },
    { name: "Bob", uuid: "uuid-2" },
  ]),
  saveJson: vi.fn().mockResolvedValue(undefined),
  invalidateWhitelistCache: vi.fn(),
}));

// /map now reads through loadConfig() instead of loadJson(config.json)
vi.mock("../src/common/config.js", () => ({
  loadConfig: vi.fn().mockReturnValue({ commands: {} }),
}));

import { resolveServer } from "../src/bot/utils/guildRouter.js";
import { loadWhitelist, invalidateWhitelistCache } from "../src/common/utils/utils.js";
import { loadConfig } from "../src/common/config.js";

function makeServer(id = "survival") {
  return {
    id,
    config: { id },
    sendCommand: vi.fn().mockResolvedValue(undefined),
  } as never;
}

function makeInteraction(opts: Record<string, unknown> = {}) {
  return {
    user: { id: "u1", tag: "Admin#0001", displayName: "Admin" },
    commandName: "cmd",
    deferred: false,
    replied: false,
    channel: {
      bulkDelete: vi.fn().mockResolvedValue(
        new Map([
          ["m1", {}],
          ["m2", {}],
        ]),
      ),
      name: "general",
    },
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue({ id: "msg1" }),
    reply: vi.fn().mockResolvedValue(undefined),
    options: {
      getString: vi.fn().mockReturnValue(null),
      getInteger: vi.fn().mockReturnValue(5),
      getBoolean: vi.fn().mockReturnValue(null),
    },
    ...opts,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolveServer).mockReturnValue(makeServer());
});

// ══════════════════════════════════════════════════════════════════════════════
// /whitelist
// ══════════════════════════════════════════════════════════════════════════════

describe("/whitelist command", () => {
  let execute: (i: never) => Promise<void>;

  beforeEach(async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ id: "uuid-99", name: "Steve" }),
      }),
    );
    ({ execute } = await import("../src/bot/commands/whitelist.js"));
  });

  it("whitelists a valid player and replies with success", async () => {
    const interaction = makeInteraction({
      options: {
        getString: vi
          .fn()
          .mockImplementation((n: string) =>
            n === "username" ? "Steve" : null,
          ),
      },
    });
    await execute(interaction);
    expect(interaction.editReply).toHaveBeenCalled();
    // A successful add must invalidate the whitelist cache
    expect(invalidateWhitelistCache).toHaveBeenCalledWith("survival");
  });

  it("rejects an invalid username before any console command", async () => {
    const interaction = makeInteraction({
      options: {
        getString: vi
          .fn()
          .mockImplementation((n: string) =>
            n === "username" ? "bad name\nstop" : null,
          ),
      },
    });
    await expect(execute(interaction)).rejects.toThrow("not a valid");
    const server = vi.mocked(resolveServer).mock.results[0]!.value;
    expect(server.sendCommand).not.toHaveBeenCalled();
  });

  it("throws when Mojang API returns not-ok", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    const interaction = makeInteraction({
      options: { getString: vi.fn().mockReturnValue("NotAPlayer") },
    });
    await expect(execute(interaction)).rejects.toThrow("not found");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// /unwhitelist
// ══════════════════════════════════════════════════════════════════════════════

describe("/unwhitelist command", () => {
  let execute: (i: never) => Promise<void>;
  beforeEach(async () => {
    ({ execute } = await import("../src/bot/commands/unwhitelist.js"));
  });

  it("removes a player and replies with success", async () => {
    const interaction = makeInteraction({
      options: {
        getString: vi
          .fn()
          .mockImplementation((n: string) =>
            n === "username" ? "Steve" : null,
          ),
      },
    });
    await execute(interaction);
    const server = vi.mocked(resolveServer).mock.results[0]!.value;
    expect(server.sendCommand).toHaveBeenCalledWith(
      expect.stringContaining("/whitelist remove"),
    );
    expect(interaction.editReply).toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// /verify
// ══════════════════════════════════════════════════════════════════════════════

describe("/verify command", () => {
  let execute: (i: never) => Promise<void>;
  beforeEach(async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ id: "uuid-99", name: "Alex" }),
      }),
    );
    ({ execute } = await import("../src/bot/commands/verify.js"));
  });

  it("verifies a player and replies with success", async () => {
    const interaction = makeInteraction({
      options: {
        getString: vi
          .fn()
          .mockImplementation((n: string) =>
            n === "username" ? "Alex" : null,
          ),
      },
    });
    await execute(interaction);
    expect(interaction.editReply).toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// /whitelisted
// ══════════════════════════════════════════════════════════════════════════════

describe("/whitelisted command", () => {
  let execute: (i: never) => Promise<void>;
  beforeEach(async () => {
    ({ execute } = await import("../src/bot/commands/info/whitelisted.js"));
  });

  it("replies with the list of whitelisted players", async () => {
    const interaction = makeInteraction();
    await execute(interaction);
    expect(interaction.editReply).toHaveBeenCalled();
  });

  it("explains an empty whitelist (may be disabled)", async () => {
    vi.mocked(loadWhitelist).mockResolvedValue([]);
    const interaction = makeInteraction();
    await execute(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("may be disabled"),
      }),
    );
  });

  it("paginates when there are many players", async () => {
    const manyPlayers = Array.from({ length: 25 }, (_, i) => ({
      name: `Player${i}`,
      uuid: `uuid-${i}`,
    }));
    vi.mocked(loadWhitelist).mockResolvedValue(manyPlayers);
    const interaction = makeInteraction();
    await execute(interaction);
    expect(interaction.editReply).toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// /clear
// ══════════════════════════════════════════════════════════════════════════════

describe("/clear command", () => {
  let execute: (i: never) => Promise<void>;
  beforeEach(async () => {
    ({ execute } = await import("../src/bot/commands/moderation/clear.js"));
  });

  it("bulk-deletes messages and replies with count", async () => {
    const deleted = new Map([
      ["m1", {}],
      ["m2", {}],
    ]);
    const interaction = makeInteraction({
      options: {
        getInteger: vi.fn().mockReturnValue(5),
        getString: vi.fn().mockReturnValue(null),
      },
      channel: {
        bulkDelete: vi.fn().mockResolvedValue(deleted),
        name: "general",
      },
    });
    await execute(interaction);
    expect(interaction.editReply).toHaveBeenCalled();
  });

  it("throws when channel does not support bulkDelete", async () => {
    const interaction = makeInteraction({ channel: null });
    await expect(execute(interaction)).rejects.toThrow("text channel");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// /map
// ══════════════════════════════════════════════════════════════════════════════

describe("/map command", () => {
  let execute: (i: never) => Promise<void>;
  beforeEach(async () => {
    ({ execute } = await import("../src/bot/commands/general/map.js"));
  });

  it("replies with error when map URL is not configured", async () => {
    vi.mocked(loadConfig).mockReturnValue({ commands: {} } as never);
    const interaction = makeInteraction();
    await execute(interaction);
    expect(interaction.editReply).toHaveBeenCalled();
  });

  it("replies with map embed when URL is configured", async () => {
    vi.mocked(loadConfig).mockReturnValue({
      commands: { map: { url: "https://map.example.com" } },
    } as never);
    const interaction = makeInteraction();
    await execute(interaction);
    expect(interaction.editReply).toHaveBeenCalled();
  });
});
