/**
 * AUD-015: a webhook send that fails falls back to the embed form, and a
 * deleted webhook is resolved again on the next line.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../src/bot/utils/embeds/embedUtils.js", () => ({
  createPlayerEmbed: vi.fn().mockReturnValue({ type: "player-embed" }),
}));

const guildConfigs = {
  g1: { chatBridge: { channelId: "ch1", server: "main", useWebhook: true } },
} as never;

function setup(hookSend: ReturnType<typeof vi.fn>) {
  const channelSend = vi.fn().mockResolvedValue(undefined);
  const fetchWebhooks = vi.fn().mockResolvedValue(
    [{ name: "minecraft-bot bridge", token: "t", send: hookSend }],
  );
  const channel = { send: channelSend, fetchWebhooks, createWebhook: vi.fn() };
  const client = { channels: { fetch: vi.fn().mockResolvedValue(channel) } };
  let handler: ((m: string[]) => void) | undefined;
  const logWatcher = {
    server: { id: "main" },
    register: vi.fn((_re: RegExp, h: (m: string[]) => void) => {
      handler = h;
    }),
  };
  return { client, logWatcher, channelSend, fetchWebhooks, line: (p: string, m: string) => handler!(["", p, m]) };
}

describe("chat bridge webhook delivery", () => {
  beforeEach(() => vi.resetModules());

  it("sends as an embed when the webhook refuses the message", async () => {
    const { registerChatBridge, flushBridgeQueues } = await import(
      "../../src/bot/logWatcher/watchers/log/chatBridge.js"
    );
    const hookSend = vi.fn().mockRejectedValue(Object.assign(new Error("Invalid Form Body"), { code: 50035 }));
    const t = setup(hookSend);
    registerChatBridge(t.logWatcher as never, t.client as never, guildConfigs, ["main"]);
    t.line("ClydeFan", "hi");
    await flushBridgeQueues();
    expect(hookSend).toHaveBeenCalledTimes(1);
    expect(t.channelSend).toHaveBeenCalledTimes(1);
  });

  it("resolves a deleted webhook again", async () => {
    const { registerChatBridge, flushBridgeQueues } = await import(
      "../../src/bot/logWatcher/watchers/log/chatBridge.js"
    );
    const hookSend = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("Unknown Webhook"), { code: 10015 }))
      .mockResolvedValue(undefined);
    const t = setup(hookSend);
    registerChatBridge(t.logWatcher as never, t.client as never, guildConfigs, ["main"]);
    await flushBridgeQueues();
    const before = t.fetchWebhooks.mock.calls.length;
    t.line("Steve", "one");
    await flushBridgeQueues();
    t.line("Steve", "two");
    await flushBridgeQueues();
    expect(t.channelSend).toHaveBeenCalledTimes(1);
    expect(t.fetchWebhooks.mock.calls.length).toBe(before + 1);
    expect(hookSend).toHaveBeenCalledTimes(2);
  });
});
