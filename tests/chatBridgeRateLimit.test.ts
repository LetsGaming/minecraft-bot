/**
 * The Discord→MC bridge listens on messageCreate and bypasses the
 * slash-command rate limiter entirely. These tests verify the bridge's own
 * per-user token bucket: bursts pass, floods are cut off with visible
 * feedback (⏳ reaction), and other users are unaffected.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../src/utils/embedUtils.js", () => ({
  createPlayerEmbed: vi.fn().mockReturnValue({ type: "player-embed" }),
}));

type Handler = (...args: never[]) => Promise<void> | void;

function makeClient() {
  const handlers = new Map<string, Handler>();
  return {
    on: vi.fn((event: string, handler: Handler) => {
      handlers.set(event, handler);
    }),
    _trigger: async (event: string, ...args: never[]) =>
      handlers.get(event)?.(...args),
  };
}

function makeMsg(userId: string, content = "hello") {
  return {
    author: { bot: false, id: userId, displayName: `User${userId}` },
    guild: { id: "guild1" },
    channel: { id: "bridge-channel" },
    content,
    react: vi.fn().mockResolvedValue(undefined),
  };
}

const guildConfigs = {
  guild1: { chatBridge: { channelId: "bridge-channel", server: "main" } },
} as never;

describe("Discord→MC bridge rate limiting", () => {
  let setupDiscordToMc: (
    client: never,
    guildConfigs: never,
    getInstance: (id: string | undefined) => never,
  ) => void;

  beforeEach(async () => {
    // Fresh module per test → fresh token buckets.
    vi.resetModules();
    ({ setupDiscordToMc } = await import(
      "../src/logWatcher/watchers/chatBridge.js"
    ));
  });

  it("lets a normal burst through and cuts off a flood with feedback", async () => {
    const client = makeClient();
    const server = { sendCommand: vi.fn().mockResolvedValue(undefined) };
    setupDiscordToMc(client as never, guildConfigs, () => server as never);

    const messages = Array.from({ length: 12 }, (_, i) =>
      makeMsg("spammer", `msg ${i}`),
    );
    for (const msg of messages) {
      await client._trigger("messageCreate", msg as never);
    }

    // Bucket capacity is 8: the first 8 reach the game, the rest do not.
    expect(server.sendCommand).toHaveBeenCalledTimes(8);
    // Blocked messages get a ⏳ reaction instead of silently vanishing.
    const reacted = messages.filter(
      (m) => m.react.mock.calls.length > 0,
    ).length;
    expect(reacted).toBe(4);
    expect(messages[11]!.react).toHaveBeenCalledWith("⏳");
  });

  it("rate limits per user — one user's flood does not block others", async () => {
    const client = makeClient();
    const server = { sendCommand: vi.fn().mockResolvedValue(undefined) };
    setupDiscordToMc(client as never, guildConfigs, () => server as never);

    for (let i = 0; i < 12; i++) {
      await client._trigger("messageCreate", makeMsg("flooder") as never);
    }
    const calm = makeMsg("bystander", "am I still heard?");
    await client._trigger("messageCreate", calm as never);

    // 8 from the flooder + 1 from the bystander.
    expect(server.sendCommand).toHaveBeenCalledTimes(9);
    expect(calm.react).not.toHaveBeenCalled();
  });

  it("refills over time so limited users recover", async () => {
    vi.useFakeTimers();
    try {
      const client = makeClient();
      const server = { sendCommand: vi.fn().mockResolvedValue(undefined) };
      setupDiscordToMc(client as never, guildConfigs, () => server as never);

      for (let i = 0; i < 9; i++) {
        await client._trigger("messageCreate", makeMsg("chatty") as never);
      }
      expect(server.sendCommand).toHaveBeenCalledTimes(8);

      // Full window elapses → bucket refills.
      vi.advanceTimersByTime(10_000);
      await client._trigger(
        "messageCreate",
        makeMsg("chatty", "back again") as never,
      );
      expect(server.sendCommand).toHaveBeenCalledTimes(9);
    } finally {
      vi.useRealTimers();
    }
  });
});
