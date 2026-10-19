/**
 * Characterization tests for /poll (create, status, close): admin-gated
 * handler logic, the one-open-poll-per-server invariant, span polls and
 * the tenant-isolation checks on the servers list.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../src/bot/commands/middleware.js", () => ({
  withErrorHandling: <T>(fn: T) => fn,
  requireServerAdmin: <T>(fn: T) => fn,
}));

const guildRouter = vi.hoisted(() => ({
  resolveServer: vi.fn(),
  assertMayTargetServerId: vi.fn(),
  filterTargetableServerIds: vi.fn(),
}));
vi.mock("../../src/bot/utils/guild/guildRouter.js", () => guildRouter);

vi.mock("../../src/core/config.js", () => ({
  getServerIds: () => ["smp", "creative", "other"],
}));

const scheduler = vi.hoisted(() => ({
  armPoll: vi.fn(),
  attachCollectorToMessage: vi.fn(),
  closePoll: vi.fn(),
}));
vi.mock("../../src/bot/logWatcher/watchers/schedulers/pollScheduler.js", () => scheduler);

const tellraw = vi.fn();
vi.mock("../../src/core/utils/minecraft/serverMessages.js", () => ({
  tellraw: (...a: unknown[]) => tellraw(...a) as unknown,
}));

const recordAdminAction = vi.fn();
vi.mock("../../src/core/utils/stores/adminAudit.js", () => ({
  recordAdminAction: (e: unknown) => recordAdminAction(e) as unknown,
}));

import { execute } from "../../src/bot/commands/general/poll.js";
import {
  loadPollStore,
  savePollStore,
  type Poll,
} from "../../src/core/utils/stores/pollStore.js";
import { closeDbForTesting } from "../../src/core/db/index.js";

const smp = { id: "smp" };

function interaction(opts: {
  sub: string;
  question?: string;
  options?: string;
  duration?: number | null;
  servers?: string | null;
  channelId?: string | null;
  guildId?: string | null;
}) {
  const message = { id: "msg-1" };
  return {
    channelId: opts.channelId === undefined ? "chan-1" : opts.channelId,
    guild: opts.guildId === null ? null : { id: opts.guildId ?? "g1" },
    user: { id: "admin1", tag: "admin#1" },
    client: { id: "client" },
    options: {
      getSubcommand: () => opts.sub,
      getString: (name: string) => {
        if (name === "question") return opts.question ?? "Q?";
        if (name === "options") return opts.options ?? "Yes | No";
        if (name === "servers") return opts.servers ?? null;
        return null;
      },
      getInteger: () => opts.duration ?? null,
    },
    editReply: vi.fn().mockResolvedValue(message),
  };
}
const run = (i: unknown) =>
  (execute as unknown as (i: unknown) => Promise<void>)(i);

function openPoll(overrides: Partial<Poll> = {}): Poll {
  return {
    id: "p1",
    question: "Open?",
    options: ["A", "B"],
    guildId: "g1",
    channelId: "c",
    messageId: "m",
    serverId: "smp",
    createdBy: "x",
    createdById: "x1",
    createdAt: 1,
    endsAt: Date.now() + 100000,
    votes: { "d:1": 0, "d:2": 0, "d:3": 1 },
    status: "open",
    ...overrides,
  };
}
async function seed(...polls: Poll[]) {
  await savePollStore({ version: 1, polls });
}

beforeEach(() => {
  closeDbForTesting();
  vi.clearAllMocks();
  guildRouter.resolveServer.mockReset().mockReturnValue(smp);
  guildRouter.assertMayTargetServerId
    .mockReset()
    .mockImplementation((_i: unknown, id: string) => ({ id }));
  guildRouter.filterTargetableServerIds
    .mockReset()
    .mockImplementation((_i: unknown, ids: string[]) => ids);
  scheduler.closePoll.mockReset().mockResolvedValue(undefined);
  tellraw.mockReset().mockResolvedValue(true);
  recordAdminAction.mockReset().mockResolvedValue(undefined);
});

describe("/poll status", () => {
  it("fails when no poll is open on the server", async () => {
    await expect(run(interaction({ sub: "status" }))).rejects.toThrow();
  });

  it("shows live tallies of the open poll", async () => {
    await seed(openPoll());
    const i = interaction({ sub: "status" });
    await run(i);
    const desc = (i.editReply.mock.calls[0]![0].embeds[0].toJSON() as { description: string }).description;
    expect(desc).toContain("**1.** A");
    expect(desc).toMatch(/A.*2/);
    expect(desc).toMatch(/B.*1/);
  });

  it("ignores closed polls", async () => {
    await seed(openPoll({ status: "closed" }));
    await expect(run(interaction({ sub: "status" }))).rejects.toThrow();
  });
});

describe("/poll close", () => {
  it("fails when nothing is open", async () => {
    await expect(run(interaction({ sub: "close" }))).rejects.toThrow();
    expect(scheduler.closePoll).not.toHaveBeenCalled();
  });

  it("closes through the scheduler, audits and confirms", async () => {
    await seed(openPoll());
    const i = interaction({ sub: "close" });
    await run(i);
    expect(scheduler.closePoll).toHaveBeenCalledWith(i.client, "p1");
    expect(recordAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: "poll close", server: "smp", detail: "Open?" }),
    );
    expect(i.editReply).toHaveBeenCalledTimes(1);
  });

  it("finds a span poll through any participating server", async () => {
    await seed(openPoll({ serverId: "creative", serverIds: ["creative", "smp"] }));
    await run(interaction({ sub: "close" }));
    expect(scheduler.closePoll).toHaveBeenCalledWith(expect.anything(), "p1");
  });
});

describe("/poll create", () => {
  it("requires a channel", async () => {
    await expect(run(interaction({ sub: "create", channelId: null }))).rejects.toThrow();
  });

  it("creates, arms, collects, audits and announces in-game", async () => {
    const i = interaction({ sub: "create", question: " Fly? ", options: "Yes; No | Maybe", duration: 2 });
    await run(i);

    const store = await loadPollStore();
    expect(store.polls).toHaveLength(1);
    const poll = store.polls[0]!;
    expect(poll).toMatchObject({
      question: "Fly?",
      options: ["Yes", "No", "Maybe"],
      serverId: "smp",
      messageId: "msg-1",
      channelId: "chan-1",
      guildId: "g1",
      createdById: "admin1",
      status: "open",
    });
    expect(poll).not.toHaveProperty("serverIds");
    expect(poll.endsAt - poll.createdAt).toBe(2 * 3_600_000);
    expect(scheduler.armPoll).toHaveBeenCalledWith(i.client, poll);
    expect(scheduler.attachCollectorToMessage).toHaveBeenCalledWith(
      poll.id,
      { id: "msg-1" },
      poll.endsAt,
    );
    expect(recordAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: "poll create", server: "smp" }),
    );
    // headline + 3 options + vote hint
    expect(tellraw).toHaveBeenCalledTimes(5);
  });

  it("defaults to 24 hours and builds one button per option", async () => {
    const i = interaction({ sub: "create" });
    await run(i);
    const poll = (await loadPollStore()).polls[0]!;
    expect(poll.endsAt - poll.createdAt).toBe(24 * 3_600_000);
    const row = i.editReply.mock.calls[0]![0].components[0].toJSON() as {
      components: Array<{ custom_id: string; label: string }>;
    };
    expect(row.components.map((c) => c.custom_id)).toEqual([
      `poll:${poll.id}:0`,
      `poll:${poll.id}:1`,
    ]);
    expect(row.components[0]!.label).toBe("1. Yes");
  });

  it.each(["Only one", "A|B|C|D|E|F", " | | "])("rejects the option list %j", async (options) => {
    await expect(run(interaction({ sub: "create", options }))).rejects.toThrow();
    expect((await loadPollStore()).polls).toHaveLength(0);
  });

  it("truncates options to 80 characters", async () => {
    await run(interaction({ sub: "create", options: `${"x".repeat(120)} | y` }));
    expect((await loadPollStore()).polls[0]!.options[0]).toHaveLength(80);
  });

  it("refuses while the server already has an open poll", async () => {
    await seed(openPoll());
    await expect(run(interaction({ sub: "create" }))).rejects.toThrow();
    expect((await loadPollStore()).polls).toHaveLength(1);
  });

  it("does not announce the options when the headline did not reach the server", async () => {
    tellraw.mockResolvedValue(false);
    await run(interaction({ sub: "create" }));
    expect(tellraw).toHaveBeenCalledTimes(1);
  });

  it("span: an explicit servers list creates one poll across all instances", async () => {
    await run(interaction({ sub: "create", servers: "smp, creative smp" }));
    const poll = (await loadPollStore()).polls[0]!;
    expect(poll.serverIds).toEqual(["smp", "creative"]);
    expect(poll.serverId).toBe("smp");
    expect(guildRouter.assertMayTargetServerId).toHaveBeenCalledTimes(2);
    expect(recordAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({ server: "smp,creative" }),
    );
    // each instance: headline + 2 options + hint
    expect(tellraw).toHaveBeenCalledTimes(8);
  });

  it("span: 'all' is limited to the servers the guild may see", async () => {
    guildRouter.filterTargetableServerIds.mockReturnValue(["smp", "creative"]);
    await run(interaction({ sub: "create", servers: "ALL" }));
    expect((await loadPollStore()).polls[0]!.serverIds).toEqual(["smp", "creative"]);
  });

  it("span: a forbidden server in the list aborts creation", async () => {
    guildRouter.assertMayTargetServerId.mockImplementation((_i: unknown, id: string) => {
      if (id === "other") throw new Error("not allowed");
      return { id };
    });
    await expect(
      run(interaction({ sub: "create", servers: "smp, other" })),
    ).rejects.toThrow("not allowed");
    expect((await loadPollStore()).polls).toHaveLength(0);
  });

  it("span: refuses when any participant already has an open poll", async () => {
    await seed(openPoll({ serverId: "creative" }));
    await expect(
      run(interaction({ sub: "create", servers: "smp, creative" })),
    ).rejects.toThrow();
    expect((await loadPollStore()).polls).toHaveLength(1);
  });

  it("span: a servers value with no usable ids falls back to the single server", async () => {
    await run(interaction({ sub: "create", servers: " , " }));
    const poll = (await loadPollStore()).polls[0]!;
    expect(poll).not.toHaveProperty("serverIds");
    expect(poll.serverId).toBe("smp");
  });

  it("refuses and takes its reply back when another poll opened while the reply went out", async () => {
    const i = Object.assign(interaction({ sub: "create" }), {
      deleteReply: vi.fn().mockResolvedValue(undefined),
    });
    i.editReply.mockImplementation(async () => {
      await seed(openPoll({ id: "won-the-race" }));
      return { id: "msg-1" };
    });

    await expect(run(i)).rejects.toThrow();

    expect((await loadPollStore()).polls.map((p) => p.id)).toEqual(["won-the-race"]);
    expect(i.deleteReply).toHaveBeenCalled();
    expect(scheduler.armPoll).not.toHaveBeenCalled();
  });

  it("uses a null guild id outside guilds", async () => {
    await run(interaction({ sub: "create", guildId: null }));
    expect((await loadPollStore()).polls[0]!.guildId).toBeNull();
  });
});
