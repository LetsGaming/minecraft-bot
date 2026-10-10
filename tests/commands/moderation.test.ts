import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/bot/commands/middleware.js", () => ({
  withErrorHandling: vi.fn((fn) => fn),
  requireServerAdmin: vi.fn((fn) => fn),
}));
vi.mock("../../src/bot/utils/guild/guildRouter.js", () => ({
  resolveServer: vi.fn(),
}));
vi.mock("../../src/bot/utils/embeds/embedUtils.js", () => ({
  createSuccessEmbed: vi.fn((text: string) => ({ text })),
  createErrorEmbed: vi.fn((text: string) => ({ text })),
}));
vi.mock("../../src/core/utils/stores/adminAudit.js", () => ({
  recordAdminAction: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../src/core/utils/stores/tempBanStore.js", () => ({
  putTempBan: vi.fn().mockResolvedValue(undefined),
  removeTempBan: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../src/bot/logWatcher/watchers/schedulers/tempBanScheduler.js", () => ({
  armTempBan: vi.fn(),
  cancelTempBanTimer: vi.fn(),
}));

import { resolveServer } from "../../src/bot/utils/guild/guildRouter.js";
import { recordAdminAction } from "../../src/core/utils/stores/adminAudit.js";
import {
  putTempBan,
  removeTempBan,
} from "../../src/core/utils/stores/tempBanStore.js";
import { armTempBan } from "../../src/bot/logWatcher/watchers/schedulers/tempBanScheduler.js";
import { execute as ban } from "../../src/bot/commands/moderation/ban.js";
import { execute as kick } from "../../src/bot/commands/moderation/kick.js";
import { execute as pardon } from "../../src/bot/commands/moderation/pardon.js";

function interaction(options: Record<string, string | null>) {
  return {
    user: { id: "u1", tag: "Admin#0001" },
    guild: { id: "g1" },
    client: {},
    options: {
      getString: vi.fn((name: string) => options[name] ?? null),
    },
    editReply: vi.fn().mockResolvedValue(undefined),
  } as never;
}

function useServer(send: ReturnType<typeof vi.fn>) {
  const server = { id: "survival", send, sendCommand: send };
  vi.mocked(resolveServer).mockReturnValue(server as never);
  return server;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("moderation commands", () => {
  it("/ban sends the console command, records the audit entry and replies", async () => {
    const server = useServer(vi.fn().mockResolvedValue(""));
    const i = interaction({ player: "Steve", reason: "griefing" });
    await ban(i);
    expect(server.sendCommand.mock.calls[0]![0]).toBe("/ban Steve griefing");
    expect(recordAdminAction).toHaveBeenCalledOnce();
    expect(vi.mocked(i.editReply)).toHaveBeenCalledOnce();
    expect(putTempBan).not.toHaveBeenCalled();
  });

  it("/ban with a duration stores and arms a timed ban", async () => {
    useServer(vi.fn().mockResolvedValue(""));
    await ban(interaction({ player: "Steve", duration: "1h" }));
    expect(putTempBan).toHaveBeenCalledOnce();
    expect(armTempBan).toHaveBeenCalledOnce();
  });

  it("/kick sends the console command, records the audit entry and replies", async () => {
    const server = useServer(vi.fn().mockResolvedValue(""));
    const i = interaction({ player: "Steve" });
    await kick(i);
    expect(server.sendCommand.mock.calls[0]![0]).toBe("/kick Steve");
    expect(recordAdminAction).toHaveBeenCalledOnce();
    expect(vi.mocked(i.editReply)).toHaveBeenCalledOnce();
  });

  it("/pardon sends the console command and drops the timed-ban record", async () => {
    const server = useServer(vi.fn().mockResolvedValue(""));
    await pardon(interaction({ player: "Steve" }));
    expect(server.sendCommand.mock.calls[0]![0]).toBe("/pardon Steve");
    expect(removeTempBan).toHaveBeenCalledWith("survival", "Steve");
  });

  it("rejects an invalid username before sending anything", async () => {
    const server = useServer(vi.fn());
    await expect(ban(interaction({ player: "bad name" }))).rejects.toThrow();
    await expect(kick(interaction({ player: "bad name" }))).rejects.toThrow();
    await expect(pardon(interaction({ player: "bad name" }))).rejects.toThrow();
    expect(server.sendCommand).not.toHaveBeenCalled();
  });
});
