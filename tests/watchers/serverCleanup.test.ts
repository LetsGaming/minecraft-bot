/**
 * A removed and re-added server id must not inherit the old server's
 * per-server watcher state.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../src/core/config.js", () => ({
  loadConfig: vi.fn().mockReturnValue({ tpsWarningThreshold: 15, tpsPollIntervalMs: 100 }),
}));
vi.mock("../../src/bot/utils/guild/guildRouter.js", () => ({
  serverInScope: () => true,
  getAllowedServerIds: () => null,
}));
vi.mock("../../src/bot/utils/embeds/embedUtils.js", () => ({
  createEmbed: vi.fn().mockReturnValue({
    addFields: vi.fn().mockReturnThis(),
    setFooter: vi.fn().mockReturnThis(),
  }),
}));

import { startTpsMonitor } from "../../src/bot/logWatcher/watchers/monitors/tpsMonitor.js";
import { forgetServer } from "../../src/bot/logWatcher/serverCleanup.js";
import { registerSleepWatcher } from "../../src/bot/logWatcher/watchers/log/sleepWatcher.js";
import { flushSendQueues } from "../../src/bot/logWatcher/watchers/sendQueue.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("forgetServer", () => {
  it("lets a re-added server alert again inside the repeat window", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const client = { channels: { fetch: vi.fn().mockResolvedValue({ send }) } } as never;
    const guilds = { g1: { tpsAlerts: { channelId: "ch1" } } } as never;
    const server = { id: "cleanup-tps", getTps: vi.fn().mockResolvedValue({ tps1m: 5 }) } as never;

    const first = startTpsMonitor(server, client, guilds);
    await vi.advanceTimersByTimeAsync(100);
    expect(send).toHaveBeenCalledTimes(1);
    first!.stop();

    // Same level inside the five-minute repeat window: stays quiet.
    const second = startTpsMonitor(server, client, guilds);
    await vi.advanceTimersByTimeAsync(100);
    expect(send).toHaveBeenCalledTimes(1);
    second!.stop();

    forgetServer("cleanup-tps");

    const third = startTpsMonitor(server, client, guilds);
    await vi.advanceTimersByTimeAsync(100);
    expect(send).toHaveBeenCalledTimes(2);
    third!.stop();
  });

  it("clears the sleep prompt cooldown", async () => {
    const handlers: Array<(m: RegExpExecArray, c: unknown, s: unknown) => void | Promise<void>> = [];
    let regex!: RegExp;
    registerSleepWatcher({
      server: { id: "cleanup-sleep" },
      register: (re: RegExp, h: never) => {
        regex = re;
        handlers.push(h);
      },
    } as never);
    const send = vi.fn(async (cmd: string) =>
      cmd.includes("SleepTimer")
        ? { kind: "delivered", output: "Steve has the following entity data: 87s" }
        : { kind: "delivered", output: "The time is 13000" },
    );
    const server = { id: "cleanup-sleep", send };
    const fire = async () => {
      await handlers[0]!(regex.exec("[12:00:00] [INFO]: <Steve> liege wie")!, null, server);
      await flushSendQueues();
    };

    await fire();
    const titlesAfterFirst = send.mock.calls.filter(([c]) => c.startsWith("/title")).length;
    expect(titlesAfterFirst).toBeGreaterThan(0);

    await fire();
    expect(send.mock.calls.filter(([c]) => c.startsWith("/title")).length).toBe(titlesAfterFirst);

    forgetServer("cleanup-sleep");
    await fire();
    expect(send.mock.calls.filter(([c]) => c.startsWith("/title")).length).toBeGreaterThan(
      titlesAfterFirst,
    );
  });
});
