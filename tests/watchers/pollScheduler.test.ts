/**
 * Characterization tests for the poll lifecycle: close timers, the
 * button-vote collector, idempotent closing and the both-direction result
 * announcement.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const tellraw = vi.fn();
vi.mock("../../src/core/utils/minecraft/serverMessages.js", () => ({
  tellraw: (...a: unknown[]) => tellraw(...a) as unknown,
}));

const getServerInstance = vi.fn();
vi.mock("../../src/core/utils/server/server.js", () => ({
  getServerInstance: (id: string) => getServerInstance(id) as unknown,
}));

import {
  armPoll,
  attachCollectorToMessage,
  closePoll,
  startPollScheduler,
  _resetStateForTesting,
} from "../../src/bot/logWatcher/watchers/schedulers/pollScheduler.js";
import {
  loadPollStore,
  savePollStore,
  type Poll,
} from "../../src/core/utils/stores/pollStore.js";
import { closeDbForTesting } from "../../src/core/db/index.js";
import type { Client, Message } from "discord.js";

function poll(overrides: Partial<Poll> = {}): Poll {
  return {
    id: "p1",
    question: "Fly?",
    options: ["Yes", "No"],
    guildId: "g1",
    channelId: "chan",
    messageId: "msg",
    serverId: "smp",
    createdBy: "a",
    createdById: "a1",
    createdAt: 1,
    endsAt: Date.now() + 60_000,
    votes: { "d:1": 0, "d:2": 0, "d:3": 1 },
    status: "open",
    ...overrides,
  };
}
const seed = (...polls: Poll[]) => savePollStore({ version: 1, polls });

const send = vi.fn();
const edit = vi.fn();
function makeClient(channel?: unknown) {
  const ch = channel ?? {
    send,
    messages: { fetch: vi.fn().mockResolvedValue({ edit }) },
  };
  return { channels: { fetch: vi.fn().mockResolvedValue(ch) } } as unknown as Client;
}

beforeEach(() => {
  closeDbForTesting();
  vi.useFakeTimers();
  vi.clearAllMocks();
  send.mockReset().mockResolvedValue(undefined);
  edit.mockReset().mockResolvedValue(undefined);
  tellraw.mockReset().mockResolvedValue(true);
  getServerInstance.mockReset().mockImplementation((id: string) => ({ id }));
});
afterEach(() => {
  _resetStateForTesting();
  vi.useRealTimers();
});

describe("closePoll", () => {
  it("closes, strips the buttons, posts the result and tellraws it", async () => {
    await seed(poll());
    await closePoll(makeClient(), "p1");

    expect((await loadPollStore()).polls[0]!.status).toBe("closed");
    expect(edit).toHaveBeenCalledWith({ components: [] });
    const desc = (send.mock.calls[0]![0].embeds[0].toJSON() as { description: string }).description;
    expect(desc).toContain("**Yes** — 2 (67%)");
    expect(desc).toContain("**No** — 1 (33%)");
    expect(desc).toContain("🏆 **Yes**");
    expect(desc).not.toContain("🏆 **No**");
    // headline + one line per option
    expect(tellraw).toHaveBeenCalledTimes(3);
  });

  it("is idempotent and ignores unknown polls", async () => {
    await seed(poll({ status: "closed" }));
    const client = makeClient();
    await closePoll(client, "p1");
    await closePoll(client, "nope");
    expect(send).not.toHaveBeenCalled();
    expect(tellraw).not.toHaveBeenCalled();
  });

  it("awards no trophy and shows 0% when nobody voted", async () => {
    await seed(poll({ votes: {} }));
    await closePoll(makeClient(), "p1");
    const desc = (send.mock.calls[0]![0].embeds[0].toJSON() as { description: string }).description;
    expect(desc).not.toContain("🏆");
    expect(desc).toContain("0 (0%)");
  });

  it("announces in-game on every participating instance, skipping unknown ones", async () => {
    getServerInstance.mockImplementation((id: string) => (id === "gone" ? null : { id }));
    await seed(poll({ serverId: "smp", serverIds: ["smp", "gone", "creative"] }));
    await closePoll(makeClient(), "p1");
    const targets = tellraw.mock.calls.map((c) => (c[0] as { id: string }).id);
    expect(new Set(targets)).toEqual(new Set(["smp", "creative"]));
  });

  it("skips the option lines on a server the headline did not reach", async () => {
    tellraw.mockResolvedValue(false);
    await seed(poll());
    await closePoll(makeClient(), "p1");
    expect(tellraw).toHaveBeenCalledTimes(1);
  });

  it("still closes and tellraws when the Discord side fails", async () => {
    await seed(poll());
    const client = {
      channels: { fetch: vi.fn().mockRejectedValue(new Error("Missing Access")) },
    } as unknown as Client;
    await expect(closePoll(client, "p1")).resolves.toBeUndefined();
    expect((await loadPollStore()).polls[0]!.status).toBe("closed");
    expect(tellraw).toHaveBeenCalled();
  });

  it("posts the result even when the original message was deleted", async () => {
    await seed(poll());
    const client = makeClient({
      send,
      messages: { fetch: vi.fn().mockRejectedValue(new Error("Unknown Message")) },
    });
    await closePoll(client, "p1");
    expect(edit).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe("armPoll", () => {
  it("closes the poll when endsAt passes", async () => {
    await seed(poll({ endsAt: Date.now() + 5_000 }));
    armPoll(makeClient(), poll({ endsAt: Date.now() + 5_000 }));
    await vi.advanceTimersByTimeAsync(4_000);
    expect((await loadPollStore()).polls[0]!.status).toBe("open");
    await vi.advanceTimersByTimeAsync(2_000);
    expect((await loadPollStore()).polls[0]!.status).toBe("closed");
  });

  it("re-arming replaces the previous timer", async () => {
    await seed(poll());
    const client = makeClient();
    armPoll(client, poll({ endsAt: Date.now() + 1_000 }));
    armPoll(client, poll({ endsAt: Date.now() + 30_000 }));
    await vi.advanceTimersByTimeAsync(5_000);
    expect((await loadPollStore()).polls[0]!.status).toBe("open");
  });

  it("fires immediately for a poll whose end passed while the bot was down", async () => {
    await seed(poll({ endsAt: Date.now() - 1_000 }));
    armPoll(makeClient(), poll({ endsAt: Date.now() - 1_000 }));
    await vi.advanceTimersByTimeAsync(0);
    expect((await loadPollStore()).polls[0]!.status).toBe("closed");
  });
});

describe("startPollScheduler", () => {
  it("re-arms open polls and leaves closed ones alone", async () => {
    await seed(
      poll({ id: "open", endsAt: Date.now() + 1_000 }),
      poll({ id: "old", status: "closed" }),
    );
    const collector = { on: vi.fn() };
    const message = {
      createMessageComponentCollector: vi.fn().mockReturnValue(collector),
    };
    const client = makeClient({
      send,
      messages: { fetch: vi.fn().mockResolvedValue(message) },
    });
    startPollScheduler(client);
    await vi.advanceTimersByTimeAsync(2_000);

    const polls = (await loadPollStore()).polls;
    expect(polls.find((p) => p.id === "open")!.status).toBe("closed");
    expect(message.createMessageComponentCollector).toHaveBeenCalledTimes(1);
  });

  it("keeps the close timer even when the collector cannot be re-attached", async () => {
    await seed(poll({ endsAt: Date.now() + 1_000 }));
    const client = makeClient({
      messages: { fetch: vi.fn().mockRejectedValue(new Error("gone")) },
      send,
    });
    startPollScheduler(client);
    await vi.advanceTimersByTimeAsync(2_000);
    expect((await loadPollStore()).polls[0]!.status).toBe("closed");
  });
});

describe("button vote collector", () => {
  function setup(pollId = "p1", endsAt = Date.now() + 60_000) {
    const handlers: Record<string, (i: unknown) => Promise<void>> = {};
    let options:
      | { filter: (i: { customId: string }) => boolean; time: number }
      | undefined;
    const message = {
      createMessageComponentCollector: vi.fn((o: typeof options) => {
        options = o;
        return {
          on: (ev: string, fn: (i: unknown) => Promise<void>) => {
            handlers[ev] = fn;
          },
        };
      }),
    };
    attachCollectorToMessage(pollId, message as unknown as Message, endsAt);
    return { collect: handlers["collect"]!, options: options! };
  }
  const click = (customId: string, userId = "u9") => ({
    customId,
    user: { id: userId },
    reply: vi.fn().mockResolvedValue(undefined),
  });

  it("only listens to this poll's buttons and keeps the collector alive for at least a second", () => {
    const { options } = setup("p1", Date.now() - 10);
    expect(options.filter({ customId: "poll:p1:0" })).toBe(true);
    expect(options.filter({ customId: "poll:p2:0" })).toBe(false);
    expect(options.time).toBe(1_000);
  });

  it("records a vote and lets the voter change their mind", async () => {
    await seed(poll({ votes: {} }));
    const { collect } = setup();
    const first = click("poll:p1:0");
    await collect(first);
    expect(first.reply).toHaveBeenCalledTimes(1);
    await collect(click("poll:p1:1"));
    expect((await loadPollStore()).polls[0]!.votes).toEqual({ "d:u9": 1 });
  });

  it("rejects votes on a closed or expired poll without recording", async () => {
    await seed(poll({ status: "closed", votes: {} }));
    const { collect } = setup();
    const i = click("poll:p1:0");
    await collect(i);
    expect(i.reply).toHaveBeenCalledTimes(1);
    expect((await loadPollStore()).polls[0]!.votes).toEqual({});

    await seed(poll({ endsAt: Date.now() - 1, votes: {} }));
    await collect(click("poll:p1:0"));
    expect((await loadPollStore()).polls[0]!.votes).toEqual({});
  });

  it.each(["poll:p1:7", "poll:p1:-1", "poll:p1:x"])(
    "silently ignores the out-of-range button %s",
    async (customId) => {
      await seed(poll({ votes: {} }));
      const { collect } = setup();
      const i = click(customId);
      await collect(i);
      expect(i.reply).not.toHaveBeenCalled();
      expect((await loadPollStore()).polls[0]!.votes).toEqual({});
    },
  );

  it("swallows handler errors", async () => {
    await seed(poll());
    const { collect } = setup();
    const i = click("poll:p1:0");
    i.reply.mockRejectedValue(new Error("Unknown interaction"));
    await expect(collect(i)).resolves.toBeUndefined();
  });
});
