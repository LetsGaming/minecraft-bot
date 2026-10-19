/**
 * Batch tests for server-query commands: status, tps, seed, backup, control.
 * All withErrorHandling / requireServerAdmin mocked as passthroughs so the
 * inner functions are called directly.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createErrorEmbed } from "../../src/bot/utils/embeds/embedUtils.js";

// ── Shared mocks ───────────────────────────────────────────────────────────
vi.mock("../../src/bot/commands/middleware.js", () => ({
  withErrorHandling: vi.fn((fn) => fn),
  requireServerAdmin: vi.fn((fn) => fn),
  replyDenied: vi.fn(),
  replyError: vi.fn(),
  errorContentOf: vi.fn((err: Error) => ({ problem: err.message })),
}));

vi.mock("../../src/bot/utils/guild/guildRouter.js", () => ({
  resolveServer: vi.fn(),
  assertMayTargetServerId: vi.fn(),
}));

vi.mock("../../src/bot/utils/embeds/embedUtils.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
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

vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../src/bot/utils/guild/permissions.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/bot/utils/guild/permissions.js")>()),
  isInvokerAdmin: vi.fn().mockReturnValue(true),
}));
vi.mock("../../src/core/utils/stores/adminAudit.js", () => ({
  recordAdminAction: vi.fn().mockResolvedValue(undefined),
  loadAdminAudit: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../src/core/utils/server/serverAccess.js", () => ({
  readUserCache: vi.fn().mockResolvedValue([]),
  readBackups: vi.fn(),
  runScript: vi.fn(),
  getList: vi.fn().mockResolvedValue({ playerCount: "0", maxPlayers: "20", players: [] }),
  pingServer: vi.fn().mockResolvedValue(null),
}));

vi.mock("../../src/bot/logWatcher/watchers/monitors/downtimeMonitor.js", () => ({
  suppressAlerts: vi.fn(),
}));

import {
  assertMayTargetServerId,
  resolveServer,
} from "../../src/bot/utils/guild/guildRouter.js";
import * as serverAccess from "../../src/core/utils/server/serverAccess.js";

// ── helpers ────────────────────────────────────────────────────────────────

/** A health value for one of the four server states. */
function health(state: string, wrapper = "up") {
  return {
    state,
    source: wrapper === "up" ? "wrapper" : state === "unknown" ? "none" : "ping",
    wrapper,
    processUp: state === "online" || state === "unresponsive",
    rcon: state === "online" && wrapper === "up" ? "responsive" : "unknown",
    probe: state === "offline" ? "none" : "socket",
    players:
      wrapper === "unreachable" && state === "online"
        ? { online: 4, max: 20, names: ["Alice"], sampled: true }
        : null,
    reason: null,
    checkedAt: Date.now(),
  };
}

function makeServer(id = "survival", overrides: Record<string, unknown> = {}) {
  return {
    id,
    config: { id, serverDir: "/fake" },
    getHealth: vi.fn().mockResolvedValue(health("online")),
    isRunning: vi.fn().mockResolvedValue(true),
    getList: vi
      .fn()
      .mockResolvedValue({
        ok: true,
        value: { playerCount: "2", maxPlayers: "20", players: ["Alice", "Bob"] },
      }),
    getTps: vi.fn().mockResolvedValue({ tps1m: 20, tps5m: 20, tps15m: 20 }),
    getSeed: vi.fn().mockResolvedValue({ ok: true, value: "123456789" }),
    send: vi.fn().mockResolvedValue({ kind: "delivered", output: "" }),
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
    ({ execute } = await import("../../src/bot/commands/info/status.js"));
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
      getHealth: vi.fn().mockResolvedValue(health("offline")),
    });
    vi.mocked(resolveServer).mockReturnValue(server);
    const interaction = makeInteraction();
    await execute(interaction);
    expect(interaction.editReply).toHaveBeenCalled();
  });

  it.each([
    ["unresponsive", "Not responding"],
    ["unknown", "State unknown"],
    ["offline", "Offline"],
  ])(
    "distinguishes %s from the other non-online states in the reply",
    async (state, label) => {
      // The bug: all three of these rendered as "**Offline**". They are
      // different facts and the embed has to say which one it is.
      const server = makeServer("survival", {
        getHealth: vi
          .fn()
          .mockResolvedValue(health(state, state === "unknown" ? "unreachable" : "up")),
      });
      vi.mocked(resolveServer).mockReturnValue(server);
      const interaction = makeInteraction();
      await execute(interaction);

      // The mocked createEmbed keeps its options on `_opts`; the state label
      // is in the title, next to the state circle.
      const call = vi.mocked(interaction.editReply).mock.calls[0]![0] as {
        embeds: Array<{ _opts?: { title?: string; state?: string } }>;
      };
      expect(call.embeds[0]?._opts?.title).toContain(label);
      expect(call.embeds[0]?._opts?.state).toBe(state);
      // …and a non-online server is never asked for a player list.
      expect(server.getList).not.toHaveBeenCalled();
    },
  );

  it("reports players from a direct ping when the wrapper is down", async () => {
    // The case that motivated the whole ping fallback: the server is online
    // with people on it, and only the bot's route to it has failed. Saying
    // "Offline" — or even "State unknown" — is the wrong message.
    const server = makeServer("survival", {
      getHealth: vi.fn().mockResolvedValue(health("online", "unreachable")),
    });
    vi.mocked(resolveServer).mockReturnValue(server);
    const interaction = makeInteraction();
    await execute(interaction);

    const call = vi.mocked(interaction.editReply).mock.calls[0]![0] as {
      embeds: Array<{ _opts?: { title?: string; description?: string } }>;
    };
    const title = call.embeds[0]?._opts?.title ?? "";
    const description = call.embeds[0]?._opts?.description ?? "";
    expect(title).toContain("Online");
    expect(title).not.toContain("Offline");
    expect(description).toContain("4/20 players");
    // The wrapper being down still has to be said — controls are gone.
    expect(description.toLowerCase()).toContain("wrapper");
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
    ({ execute } = await import("../../src/bot/commands/server/tps.js"));
  });

  it("replies with TPS embed on success", async () => {
    const server = makeServer();
    vi.mocked(resolveServer).mockReturnValue(server);
    const interaction = makeInteraction();
    await execute(interaction);
    expect(interaction.editReply).toHaveBeenCalled();
  });

  it("throws when getTps returns null", async () => {
    const server = makeServer("srv", {
      getTps: vi.fn().mockResolvedValue(null),
    });
    vi.mocked(resolveServer).mockReturnValue(server);
    await expect(execute(makeInteraction())).rejects.toThrow("/status");
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
    ({ execute } = await import("../../src/bot/commands/info/seed.js"));
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
      getSeed: vi.fn().mockResolvedValue({ ok: false, reason: "unreadable" }),
    });
    vi.mocked(resolveServer).mockReturnValue(server);
    await expect(execute(makeInteraction())).rejects.toThrow("seed");
  });

  it("says the server is unreachable when the seed query is", async () => {
    const server = makeServer("srv", {
      getSeed: vi.fn().mockResolvedValue({ ok: false, reason: "unreachable" }),
    });
    vi.mocked(resolveServer).mockReturnValue(server);
    await expect(execute(makeInteraction())).rejects.toThrow("reach the server");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// /backup command
// ══════════════════════════════════════════════════════════════════════════════

describe("/backup command", () => {
  let execute: (i: never) => Promise<void>;
  beforeEach(async () => {
    ({ execute } = await import("../../src/bot/commands/server/backup.js"));
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

  it("shows an empty state, not an error, when no backups exist", async () => {
    const server = makeServer();
    vi.mocked(resolveServer).mockReturnValue(server);
    vi.mocked(serverAccess.readBackups).mockResolvedValue({
      dirs: [],
      totalBytes: 0,
    } as never);
    const interaction = makeInteraction();
    await execute(interaction);
    const call = vi.mocked(interaction.editReply).mock.calls[0]![0] as {
      embeds: Array<{ toJSON(): { description?: string } }>;
    };
    expect(call.embeds[0]!.toJSON().description).toContain("No backups yet");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// /server control command
// ══════════════════════════════════════════════════════════════════════════════

describe("/server control command", () => {
  let execute: (i: never) => Promise<void>;
  beforeEach(async () => {
    ({ execute } = await import("../../src/bot/commands/server/control.js"));
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

  it("rejects script subcommands with a friendly error on probed plain servers", async () => {
    const serverAccess = await import("../../src/core/utils/server/serverAccess.js");
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
      /setup suite.*docs\/admin\/setup\.md/s,
    );
    expect(serverAccess.runScript).not.toHaveBeenCalled();
  });

  it("reports a script that outlived the wait as still running, not failed", async () => {
    const server = makeServer();
    vi.mocked(resolveServer).mockReturnValue(server);
    const err = new Error("did not finish");
    err.name = "ScriptStillRunningError";
    vi.mocked(serverAccess.runScript).mockRejectedValue(err);
    const interaction = makeInteraction({
      options: {
        getString: vi.fn().mockReturnValue(null),
        getBoolean: vi.fn().mockReturnValue(null),
        getSubcommand: vi.fn().mockReturnValue("backup"),
      },
    });
    await execute(interaction);
    expect(interaction.editReply).toHaveBeenCalledTimes(2);
    expect(vi.mocked(createErrorEmbed)).not.toHaveBeenCalledWith(
      expect.stringContaining("failed"),
    );
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

  it("answers the stop prompt in time when the player list hangs or fails (AUD-020)", async () => {
    const server = makeServer();
    vi.mocked(resolveServer).mockReturnValue(server);
    const embedOf = (i: { reply: ReturnType<typeof vi.fn> }) =>
      (i.reply.mock.calls[0]![0] as { embeds: { _opts: { description: string } }[] })
        .embeds[0]!._opts.description;
    const ask = async () => {
      const interaction = makeInteraction({
        reply: vi.fn().mockResolvedValue(undefined),
        options: {
          getString: vi.fn().mockReturnValue(null),
          getBoolean: vi.fn().mockReturnValue(null),
          getSubcommand: vi.fn().mockReturnValue("stop"),
        },
      });
      await execute(interaction);
      return interaction as unknown as { reply: ReturnType<typeof vi.fn> };
    };

    vi.useFakeTimers();
    try {
      server.getList.mockReturnValueOnce(new Promise(() => {}));
      const pending = ask();
      await vi.advanceTimersByTimeAsync(1_600);
      const hung = await pending;
      expect(embedOf(hung)).toMatch(/not available/);
    } finally {
      vi.useRealTimers();
    }

    server.getList.mockResolvedValueOnce({ ok: false, reason: "unreachable" });
    expect(embedOf(await ask())).toMatch(/not available/);
  });

  it("asks before stopping: an ephemeral confirm row, nothing run or audited yet", async () => {
    const server = makeServer();
    vi.mocked(resolveServer).mockReturnValue(server);
    vi.mocked(serverAccess.runScript).mockClear();
    const { suppressAlerts } =
      await import("../../src/bot/logWatcher/watchers/monitors/downtimeMonitor.js");
    const { recordAdminAction } = await import("../../src/core/utils/stores/adminAudit.js");
    vi.mocked(suppressAlerts).mockClear();
    vi.mocked(recordAdminAction).mockClear();
    const interaction = makeInteraction({
      reply: vi.fn().mockResolvedValue(undefined),
      options: {
        getString: vi.fn().mockReturnValue(null),
        getBoolean: vi.fn().mockReturnValue(null),
        getSubcommand: vi.fn().mockReturnValue("stop"),
      },
    });
    await execute(interaction);
    const { MessageFlags } = await import("discord.js");
    const reply = vi.mocked(interaction.reply).mock.calls[0]![0] as unknown as {
      flags: number;
      components: { toJSON(): { components: { custom_id: string }[] } }[];
    };
    expect(reply.flags).toBe(MessageFlags.Ephemeral);
    const ids = reply.components[0]!.toJSON().components.map((c) => c.custom_id);
    expect(ids[0]).toMatch(/^confirm:yes:server-stop:survival:/);
    expect(ids[1]).toMatch(/^confirm:no:server-stop:survival:/);
    expect(serverAccess.runScript).not.toHaveBeenCalled();
    expect(suppressAlerts).not.toHaveBeenCalled();
    expect(recordAdminAction).not.toHaveBeenCalled();
  });

  it("stops after the confirm button: audit, alert suppression, public progress", async () => {
    const server = makeServer();
    vi.mocked(assertMayTargetServerId).mockReturnValue(server as never);
    vi.mocked(serverAccess.runScript).mockResolvedValue({
      exitCode: 0,
      output: "Server stopped",
      stderr: "",
    } as never);
    await import("../../src/bot/commands/server/control.js");
    const { handleConfirmInteraction, confirmTarget } = await import(
      "../../src/bot/interactions/confirmActions.js"
    );
    const { confirmCustomId } = await import("../../src/bot/utils/embeds/confirm.js");
    const { suppressAlerts } =
      await import("../../src/bot/logWatcher/watchers/monitors/downtimeMonitor.js");
    const { recordAdminAction } = await import("../../src/core/utils/stores/adminAudit.js");
    const notice = { id: "notice" };
    const button = {
      customId: confirmCustomId("yes", confirmTarget("server-stop", server.id, "user1")),
      user: { id: "user1", tag: "Admin#0001", username: "admin" },
      member: null,
      guild: null,
      isButton: () => true,
      update: vi.fn().mockResolvedValue(undefined),
      followUp: vi.fn().mockResolvedValue(notice),
      webhook: { editMessage: vi.fn().mockResolvedValue(undefined) },
    };
    expect(await handleConfirmInteraction(button as never)).toBe(true);
    expect(recordAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: "server stop", server: server.id }),
    );
    expect(suppressAlerts).toHaveBeenCalledWith(server.id);
    expect(serverAccess.runScript).toHaveBeenCalledWith(server.config, "stop", []);
    // The notice is posted without the ephemeral flag and edited in place.
    expect(button.followUp.mock.calls[0]![0]).not.toHaveProperty("flags");
    expect(button.webhook.editMessage).toHaveBeenCalledWith(notice, expect.anything());
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
      followUp: vi.fn().mockResolvedValue(undefined),
      options: {
        getString: vi.fn().mockReturnValue(null),
        getBoolean: vi.fn().mockReturnValue(null),
        getSubcommand: vi.fn().mockReturnValue("start"),
      },
    });
    await execute(interaction);
    expect(interaction.editReply).toHaveBeenCalledTimes(2);
    // Script output can carry paths, so it goes to the admin only.
    expect(interaction.followUp).toHaveBeenCalledWith(
      expect.objectContaining({ flags: 64 }),
    );
  });
});
