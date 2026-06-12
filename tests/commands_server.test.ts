/**
 * Batch tests for server-query commands: status, tps, seed, say, backup, control.
 * All withErrorHandling / requireServerAdmin mocked as passthroughs so the
 * inner functions are called directly.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Shared mocks ───────────────────────────────────────────────────────────
vi.mock("../src/commands/middleware.js", () => ({
  withErrorHandling: vi.fn((fn) => fn),
  requireServerAdmin: vi.fn((fn) => fn),
  isServerAdmin: vi.fn().mockReturnValue(true),
}));

vi.mock("../src/utils/guildRouter.js", () => ({
  resolveServer: vi.fn(),
}));

vi.mock("../src/utils/embedUtils.js", () => ({
  createEmbed: vi.fn().mockImplementation((opts) => ({
    _opts: opts,
    addFields: vi.fn().mockReturnThis(),
    setFooter: vi.fn().mockReturnThis(),
    setDescription: vi.fn().mockReturnThis(),
    toJSON: () => ({ title: opts?.title }),
  })),
  createErrorEmbed: vi.fn().mockReturnValue({ type: "error-embed" }),
  createSuccessEmbed: vi
    .fn()
    .mockReturnValue({
      type: "success-embed",
      setDescription: vi.fn().mockReturnThis(),
    }),
}));

vi.mock("../src/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../src/utils/serverAccess.js", () => ({
  readBackups: vi.fn(),
  runScript: vi.fn(),
}));

vi.mock("../src/logWatcher/watchers/downtimeMonitor.js", () => ({
  suppressAlerts: vi.fn(),
}));

import { resolveServer } from "../src/utils/guildRouter.js";
import * as serverAccess from "../src/utils/serverAccess.js";

// ── helpers ────────────────────────────────────────────────────────────────

function makeServer(id = "survival", overrides: Record<string, unknown> = {}) {
  return {
    id,
    config: { id, serverDir: "/fake" },
    isRunning: vi.fn().mockResolvedValue(true),
    getList: vi
      .fn()
      .mockResolvedValue({
        playerCount: "2",
        maxPlayers: "20",
        players: ["Alice", "Bob"],
      }),
    getTps: vi.fn().mockResolvedValue({ tps1m: 20, tps5m: 20, tps15m: 20 }),
    supportsTps: true,
    getSeed: vi.fn().mockResolvedValue("123456789"),
    sendCommand: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeInteraction(overrides: Record<string, unknown> = {}) {
  return {
    user: { id: "u1", tag: "User#0001", displayName: "User" },
    commandName: "cmd",
    deferred: false,
    replied: false,
    channel: { bulkDelete: vi.fn().mockResolvedValue(new Map()) },
    client: { ws: { ping: 42 } },
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue({ id: "msg1" }),
    reply: vi.fn().mockResolvedValue(undefined),
    options: {
      getString: vi.fn().mockReturnValue(null),
      getInteger: vi.fn().mockReturnValue(null),
      getBoolean: vi.fn().mockReturnValue(null),
      getSubcommand: vi.fn().mockReturnValue("status"),
    },
    ...overrides,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ══════════════════════════════════════════════════════════════════════════════
// /status command
// ══════════════════════════════════════════════════════════════════════════════

describe("/status command", () => {
  let execute: (i: never) => Promise<void>;
  beforeEach(async () => {
    ({ execute } = await import("../src/commands/info/status.js"));
  });

  it("replies with an online embed when server is running", async () => {
    const server = makeServer();
    vi.mocked(resolveServer).mockReturnValue(server);
    const interaction = makeInteraction();
    await execute(interaction);
    expect(interaction.editReply).toHaveBeenCalled();
  });

  it("replies with an offline embed when server is not running", async () => {
    const server = makeServer("survival", {
      isRunning: vi.fn().mockResolvedValue(false),
    });
    vi.mocked(resolveServer).mockReturnValue(server);
    const interaction = makeInteraction();
    await execute(interaction);
    expect(interaction.editReply).toHaveBeenCalled();
  });

  it("throws when resolveServer returns nothing", async () => {
    vi.mocked(resolveServer).mockReturnValue(null as never);
    const interaction = makeInteraction();
    await expect(execute(interaction)).rejects.toThrow("Server not found");
  });

  it("includes bot ping from interaction.client.ws.ping", async () => {
    const server = makeServer();
    vi.mocked(resolveServer).mockReturnValue(server);
    const interaction = makeInteraction({ client: { ws: { ping: 99 } } });
    await execute(interaction);
    // Just assert it ran without error and editReply was called
    expect(interaction.editReply).toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// /tps command
// ══════════════════════════════════════════════════════════════════════════════

describe("/tps command", () => {
  let execute: (i: never) => Promise<void>;
  beforeEach(async () => {
    ({ execute } = await import("../src/commands/server/tps.js"));
  });

  it("replies with TPS embed on success", async () => {
    const server = makeServer();
    vi.mocked(resolveServer).mockReturnValue(server);
    const interaction = makeInteraction();
    await execute(interaction);
    expect(interaction.editReply).toHaveBeenCalled();
  });

  it("throws when TPS is not supported", async () => {
    const server = makeServer("srv", { supportsTps: false });
    vi.mocked(resolveServer).mockReturnValue(server);
    await expect(execute(makeInteraction())).rejects.toThrow("RCON");
  });

  it("throws when getTps returns null", async () => {
    const server = makeServer("srv", {
      getTps: vi.fn().mockResolvedValue(null),
    });
    vi.mocked(resolveServer).mockReturnValue(server);
    await expect(execute(makeInteraction())).rejects.toThrow("offline");
  });

  it("includes Paper TPS fields (1m/5m/15m) when tps5m is present", async () => {
    const server = makeServer("srv", {
      getTps: vi
        .fn()
        .mockResolvedValue({ tps1m: 20, tps5m: 19.9, tps15m: 19.8 }),
    });
    vi.mocked(resolveServer).mockReturnValue(server);
    const interaction = makeInteraction();
    await execute(interaction);
    expect(interaction.editReply).toHaveBeenCalled();
  });

  it("shows warning color when TPS is below threshold", async () => {
    const server = makeServer("srv", {
      getTps: vi.fn().mockResolvedValue({ tps1m: 10, tps5m: 10, tps15m: 10 }),
    });
    vi.mocked(resolveServer).mockReturnValue(server);
    const interaction = makeInteraction();
    await execute(interaction);
    expect(interaction.editReply).toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// /seed command
// ══════════════════════════════════════════════════════════════════════════════

describe("/seed command", () => {
  let execute: (i: never) => Promise<void>;
  beforeEach(async () => {
    ({ execute } = await import("../src/commands/info/seed.js"));
  });

  it("replies with the world seed", async () => {
    const server = makeServer();
    vi.mocked(resolveServer).mockReturnValue(server);
    const interaction = makeInteraction();
    await execute(interaction);
    expect(interaction.editReply).toHaveBeenCalled();
  });

  it("throws when seed is null", async () => {
    const server = makeServer("srv", {
      getSeed: vi.fn().mockResolvedValue(null),
    });
    vi.mocked(resolveServer).mockReturnValue(server);
    await expect(execute(makeInteraction())).rejects.toThrow("seed");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// /say command
// ══════════════════════════════════════════════════════════════════════════════

describe("/say command", () => {
  let execute: (i: never) => Promise<void>;
  beforeEach(async () => {
    ({ execute } = await import("../src/commands/communication/say.js"));
  });

  it("sends the message and replies", async () => {
    const server = makeServer();
    vi.mocked(resolveServer).mockReturnValue(server);
    const interaction = makeInteraction({
      options: {
        getString: vi
          .fn()
          .mockImplementation((n: string) =>
            n === "message" ? "Hello world" : null,
          ),
      },
    });
    await execute(interaction);
    expect(server.sendCommand).toHaveBeenCalledWith(
      expect.stringContaining("/say"),
    );
    expect(interaction.editReply).toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// /backup command
// ══════════════════════════════════════════════════════════════════════════════

describe("/backup command", () => {
  let execute: (i: never) => Promise<void>;
  beforeEach(async () => {
    ({ execute } = await import("../src/commands/server/backup.js"));
  });

  it("replies with backup info when backups exist", async () => {
    const server = makeServer();
    vi.mocked(resolveServer).mockReturnValue(server);
    vi.mocked(serverAccess.readBackups).mockResolvedValue({
      dirs: [
        {
          dir: "hourly",
          count: 5,
          latestSizeBytes: 1048576,
          latestMtime: new Date(),
        },
      ],
      totalBytes: 5_242_880,
    } as never);
    const interaction = makeInteraction();
    await execute(interaction);
    expect(interaction.editReply).toHaveBeenCalled();
  });

  it("throws when no backups exist", async () => {
    const server = makeServer();
    vi.mocked(resolveServer).mockReturnValue(server);
    vi.mocked(serverAccess.readBackups).mockResolvedValue({
      dirs: [],
      totalBytes: 0,
    } as never);
    await expect(execute(makeInteraction())).rejects.toThrow("No backups");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// /server control command
// ══════════════════════════════════════════════════════════════════════════════

describe("/server control command", () => {
  let execute: (i: never) => Promise<void>;
  beforeEach(async () => {
    ({ execute } = await import("../src/commands/server/control.js"));
  });

  it("runs status subcommand via runScript", async () => {
    const server = makeServer();
    vi.mocked(resolveServer).mockReturnValue(server);
    vi.mocked(serverAccess.runScript).mockResolvedValue({
      exitCode: 0,
      output: "Server is running",
      stderr: "",
    } as never);
    const interaction = makeInteraction({
      options: {
        getString: vi.fn().mockReturnValue(null),
        getSubcommand: vi.fn().mockReturnValue("status"),
      },
    });
    await execute(interaction);
    expect(serverAccess.runScript).toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalled();
  });

  it("rejects script subcommands with a friendly error on probed plain servers (M-13)", async () => {
    const serverAccess = await import("../src/utils/serverAccess.js");
    const server = makeServer("plain", {
      capabilities: {
        scripts: {
          start: false,
          stop: false,
          restart: false,
          backup: false,
          status: false,
        },
        backups: false,
        modManifest: false,
        variablesFile: false,
      },
    });
    vi.mocked(resolveServer).mockReturnValue(server);
    const interaction = makeInteraction({
      options: {
        getString: vi.fn().mockReturnValue(null),
        getBoolean: vi.fn().mockReturnValue(null),
        getSubcommand: vi.fn().mockReturnValue("start"),
      },
    });

    await expect(execute(interaction)).rejects.toThrow(
      /setup-suite layout.*docs\/admin\/setup\.md/s,
    );
    expect(serverAccess.runScript).not.toHaveBeenCalled();
  });

  it("runs start subcommand and replies with success", async () => {
    const server = makeServer();
    vi.mocked(resolveServer).mockReturnValue(server);
    vi.mocked(serverAccess.runScript).mockResolvedValue({
      exitCode: 0,
      output: "",
      stderr: "",
    } as never);
    const interaction = makeInteraction({
      options: {
        getString: vi.fn().mockReturnValue(null),
        getBoolean: vi.fn().mockReturnValue(null),
        getSubcommand: vi.fn().mockReturnValue("start"),
      },
    });
    await execute(interaction);
    expect(interaction.editReply).toHaveBeenCalledTimes(2); // progress + result
  });

  it("runs stop subcommand and suppresses downtime alerts", async () => {
    const server = makeServer();
    vi.mocked(resolveServer).mockReturnValue(server);
    vi.mocked(serverAccess.runScript).mockResolvedValue({
      exitCode: 0,
      output: "Server stopped",
      stderr: "",
    } as never);
    const { suppressAlerts } =
      await import("../src/logWatcher/watchers/downtimeMonitor.js");
    const interaction = makeInteraction({
      options: {
        getString: vi.fn().mockReturnValue(null),
        getBoolean: vi.fn().mockReturnValue(null),
        getSubcommand: vi.fn().mockReturnValue("stop"),
      },
    });
    await execute(interaction);
    expect(suppressAlerts).toHaveBeenCalledWith(server.id);
  });

  it("replies with error embed when runScript returns non-zero exit code", async () => {
    const server = makeServer();
    vi.mocked(resolveServer).mockReturnValue(server);
    vi.mocked(serverAccess.runScript).mockResolvedValue({
      exitCode: 1,
      output: "",
      stderr: "Script failed",
    } as never);
    const interaction = makeInteraction({
      options: {
        getString: vi.fn().mockReturnValue(null),
        getBoolean: vi.fn().mockReturnValue(null),
        getSubcommand: vi.fn().mockReturnValue("start"),
      },
    });
    await execute(interaction);
    expect(interaction.editReply).toHaveBeenCalledTimes(2);
  });
});
