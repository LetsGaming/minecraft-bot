/**
 * /server prune-stats asks with a confirm button like stop and restart, and
 * every confirm button re-checks at press time that the guild may target the
 * server named in its custom id.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MessageFlags } from "discord.js";

vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../src/bot/commands/middleware.js", () => ({
  withErrorHandling: (fn: unknown) => fn,
  requireServerAdmin: (fn: unknown) => fn,
  isServerAdmin: vi.fn().mockReturnValue(true),
  getMemberRoleIds: vi.fn().mockReturnValue([]),
  replyDenied: vi.fn(),
  replyError: vi.fn(),
  errorContentOf: vi.fn((err: Error) => ({ problem: err.message })),
}));
vi.mock("../../src/bot/utils/guild/guildRouter.js", () => ({
  resolveServer: vi.fn(),
  assertMayTargetServerId: vi.fn(),
}));
vi.mock("../../src/core/utils/stores/adminAudit.js", () => ({
  recordAdminAction: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../src/bot/logWatcher/watchers/monitors/downtimeMonitor.js", () => ({
  suppressAlerts: vi.fn(),
}));
vi.mock("../../src/core/utils/server/serverAccess.js", () => ({
  runScript: vi.fn(),
}));
vi.mock("../../src/core/utils/minecraft/statUtils.js", () => ({
  loadAllStats: vi.fn(),
  deleteStats: vi.fn(),
}));
vi.mock("../../src/core/utils/minecraft/whitelist.js", () => ({
  loadWhitelist: vi.fn(),
}));

import {
  assertMayTargetServerId,
  resolveServer,
} from "../../src/bot/utils/guild/guildRouter.js";
import { replyError } from "../../src/bot/commands/middleware.js";
import { recordAdminAction } from "../../src/core/utils/stores/adminAudit.js";
import * as serverAccess from "../../src/core/utils/server/serverAccess.js";
import { loadAllStats, deleteStats } from "../../src/core/utils/minecraft/statUtils.js";
import { loadWhitelist } from "../../src/core/utils/minecraft/whitelist.js";
import { suppressAlerts } from "../../src/bot/logWatcher/watchers/monitors/downtimeMonitor.js";

const server = {
  id: "smp",
  config: { id: "smp" },
  capabilities: null,
};

function chat(sub: string) {
  return {
    user: { id: "u1", tag: "admin#1", username: "admin" },
    guild: { id: "g1" },
    guildId: "g1",
    deferred: false,
    replied: false,
    options: {
      getSubcommand: () => sub,
      getString: () => null,
      getBoolean: () => null,
    },
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue({ id: "m1" }),
    fetchReply: vi.fn().mockResolvedValue({ components: [] }),
  };
}

function button(action: string, serverId = "smp") {
  return import("../../src/bot/utils/embeds/confirm.js").then(({ confirmCustomId }) =>
    import("../../src/bot/interactions/confirmActions.js").then(({ confirmTarget }) => ({
      customId: confirmCustomId("yes", confirmTarget(action, serverId, "u1")),
      user: { id: "u1", tag: "admin#1", username: "admin" },
      member: null,
      guild: { id: "g1" },
      isButton: () => true,
      update: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined),
      followUp: vi.fn().mockResolvedValue({ id: "notice" }),
      reply: vi.fn().mockResolvedValue(undefined),
      webhook: { editMessage: vi.fn().mockResolvedValue(undefined) },
    })),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolveServer).mockReturnValue(server as never);
  vi.mocked(assertMayTargetServerId).mockReturnValue(server as never);
  vi.mocked(loadWhitelist).mockResolvedValue([{ name: "Steve", uuid: "u-steve" }] as never);
  vi.mocked(loadAllStats).mockResolvedValue({ "u-steve": {}, "u-gone": {}, "u-old": {} } as never);
  vi.mocked(deleteStats).mockResolvedValue(true);
});

describe("/server prune-stats", () => {
  it("lists the orphans with a confirm button and deletes nothing", async () => {
    const { execute } = await import("../../src/bot/commands/server/control.js");
    const i = chat("prune-stats");
    await (execute as (i: never) => Promise<void>)(i as never);

    expect(i.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    const reply = i.editReply.mock.calls[0]![0] as {
      components: { toJSON(): { components: { custom_id: string }[] } }[];
    };
    const ids = reply.components[0]!.toJSON().components.map((c) => c.custom_id);
    expect(ids[0]).toMatch(/^confirm:yes:server-prune-stats:smp:/);
    expect(deleteStats).not.toHaveBeenCalled();
    expect(recordAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: "server prune-stats", detail: "dry-run" }),
    );
  });

  it("deletes the orphans after the confirm button and audits it as confirmed", async () => {
    await import("../../src/bot/commands/server/control.js");
    const { handleConfirmInteraction } = await import("../../src/bot/interactions/confirmActions.js");
    const b = await button("server-prune-stats");

    expect(await handleConfirmInteraction(b as never)).toBe(true);

    expect(deleteStats).toHaveBeenCalledTimes(2);
    expect(deleteStats).toHaveBeenCalledWith("u-gone", server);
    expect(deleteStats).toHaveBeenCalledWith("u-old", server);
    expect(recordAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: "server prune-stats", detail: "confirmed" }),
    );
    expect(b.editReply).toHaveBeenCalledTimes(1);
  });

  it("refuses to prune against an empty whitelist", async () => {
    vi.mocked(loadWhitelist).mockResolvedValue([] as never);
    const { execute } = await import("../../src/bot/commands/server/control.js");
    await expect(
      (execute as (i: never) => Promise<void>)(chat("prune-stats") as never),
    ).rejects.toThrow();
    expect(deleteStats).not.toHaveBeenCalled();
  });
});

describe("confirm buttons at press time", () => {
  it("refuses a stop for a server the guild may not target", async () => {
    await import("../../src/bot/commands/server/control.js");
    const { handleConfirmInteraction } = await import("../../src/bot/interactions/confirmActions.js");
    vi.mocked(assertMayTargetServerId).mockImplementation(() => {
      throw new Error("not allowed");
    });
    const b = await button("server-stop", "other");

    await handleConfirmInteraction(b as never);

    expect(assertMayTargetServerId).toHaveBeenCalledWith(expect.anything(), "other");
    expect(serverAccess.runScript).not.toHaveBeenCalled();
    expect(suppressAlerts).not.toHaveBeenCalled();
    expect(recordAdminAction).not.toHaveBeenCalled();
    expect(replyError).toHaveBeenCalled();
  });

  it("refuses a prune for a server the guild may not target", async () => {
    await import("../../src/bot/commands/server/control.js");
    const { handleConfirmInteraction } = await import("../../src/bot/interactions/confirmActions.js");
    vi.mocked(assertMayTargetServerId).mockImplementation(() => {
      throw new Error("not allowed");
    });
    const b = await button("server-prune-stats", "other");

    await handleConfirmInteraction(b as never);

    expect(deleteStats).not.toHaveBeenCalled();
    expect(replyError).toHaveBeenCalled();
  });
});
