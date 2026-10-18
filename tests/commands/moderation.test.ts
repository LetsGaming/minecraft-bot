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
import {
  armTempBan,
  cancelTempBanTimer,
} from "../../src/bot/logWatcher/watchers/schedulers/tempBanScheduler.js";
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

const DELIVERED = { kind: "delivered", output: "" } as const;
const SENT = { kind: "sent", via: "screen" } as const;
const UNREACHABLE = {
  kind: "unreachable",
  reason: "wrapper-down",
  detail: "fetch failed",
} as const;

function useServer(send: ReturnType<typeof vi.fn>) {
  const server = { id: "survival", send };
  vi.mocked(resolveServer).mockReturnValue(server as never);
  return server;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("moderation commands", () => {
  it("/ban sends the console command, records the audit entry and replies", async () => {
    const server = useServer(vi.fn().mockResolvedValue(DELIVERED));
    const i = interaction({ player: "Steve", reason: "griefing" });
    await ban(i);
    expect(server.send.mock.calls[0]![0]).toBe("/ban Steve griefing");
    expect(recordAdminAction).toHaveBeenCalledOnce();
    expect(vi.mocked(i.editReply)).toHaveBeenCalledOnce();
    expect(putTempBan).not.toHaveBeenCalled();
  });

  it("/ban with a duration stores and arms a timed ban", async () => {
    useServer(vi.fn().mockResolvedValue(DELIVERED));
    await ban(interaction({ player: "Steve", duration: "1h" }));
    expect(putTempBan).toHaveBeenCalledOnce();
    expect(armTempBan).toHaveBeenCalledOnce();
  });

  it("a permanent /ban clears a pending timed ban for the same player", async () => {
    useServer(vi.fn().mockResolvedValue(DELIVERED));
    await ban(interaction({ player: "Steve", duration: "1h" }));
    await ban(interaction({ player: "Steve" }));
    expect(cancelTempBanTimer).toHaveBeenCalledWith("survival", "Steve");
    expect(removeTempBan).toHaveBeenCalledWith("survival", "Steve");
  });

  it("a timed /ban does not clear the stored timed ban", async () => {
    useServer(vi.fn().mockResolvedValue(DELIVERED));
    await ban(interaction({ player: "Steve", duration: "1h" }));
    expect(removeTempBan).not.toHaveBeenCalled();
  });

  it("/kick sends the console command, records the audit entry and replies", async () => {
    const server = useServer(vi.fn().mockResolvedValue(DELIVERED));
    const i = interaction({ player: "Steve" });
    await kick(i);
    expect(server.send.mock.calls[0]![0]).toBe("/kick Steve");
    expect(recordAdminAction).toHaveBeenCalledOnce();
    expect(vi.mocked(i.editReply)).toHaveBeenCalledOnce();
  });

  it("/pardon sends the console command and drops the timed-ban record", async () => {
    const server = useServer(vi.fn().mockResolvedValue(DELIVERED));
    await pardon(interaction({ player: "Steve" }));
    expect(server.send.mock.calls[0]![0]).toBe("/pardon Steve");
    expect(removeTempBan).toHaveBeenCalledWith("survival", "Steve");
  });

  it("rejects an invalid username before sending anything", async () => {
    const server = useServer(vi.fn());
    await expect(ban(interaction({ player: "bad name" }))).rejects.toThrow();
    await expect(kick(interaction({ player: "bad name" }))).rejects.toThrow();
    await expect(pardon(interaction({ player: "bad name" }))).rejects.toThrow();
    expect(server.send).not.toHaveBeenCalled();
  });

  it("reports an unverified result when the server has no reply channel", async () => {
    useServer(vi.fn().mockResolvedValue(SENT));
    const i = interaction({ player: "Steve" });
    await kick(i);
    expect(JSON.stringify(vi.mocked(i.editReply).mock.calls[0])).toContain("unverified");
    expect(recordAdminAction).toHaveBeenCalledOnce();
  });
});

describe("an unreachable server aborts before any state is recorded", () => {
  beforeEach(() => {
    useServer(vi.fn().mockResolvedValue(UNREACHABLE));
  });

  it("/ban records nothing, stores no timed ban and tells the admin", async () => {
    await expect(
      ban(interaction({ player: "Steve", duration: "1h" })),
    ).rejects.toThrow(/did not reach/);
    expect(putTempBan).not.toHaveBeenCalled();
    expect(armTempBan).not.toHaveBeenCalled();
    expect(recordAdminAction).not.toHaveBeenCalled();
  });

  it("/kick records nothing", async () => {
    await expect(kick(interaction({ player: "Steve" }))).rejects.toThrow(/did not reach/);
    expect(recordAdminAction).not.toHaveBeenCalled();
  });

  it("/pardon keeps the timed-ban record", async () => {
    await expect(pardon(interaction({ player: "Steve" }))).rejects.toThrow(/did not reach/);
    expect(removeTempBan).not.toHaveBeenCalled();
    expect(recordAdminAction).not.toHaveBeenCalled();
  });
});

describe("a visibly refused command is not recorded", () => {
  it("/kick on a player who is not online", async () => {
    useServer(
      vi.fn().mockResolvedValue({ kind: "delivered", output: "No player was found" }),
    );
    await expect(kick(interaction({ player: "Steve" }))).rejects.toThrow(/refused/);
    expect(recordAdminAction).not.toHaveBeenCalled();
  });

  it("/ban when the console does not know the command", async () => {
    useServer(
      vi.fn().mockResolvedValue({
        kind: "delivered",
        output: "Unknown or incomplete command, see below for error",
      }),
    );
    await expect(ban(interaction({ player: "Steve" }))).rejects.toThrow(/refused/);
    expect(recordAdminAction).not.toHaveBeenCalled();
  });
});
