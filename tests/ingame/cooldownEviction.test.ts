/**
 * BUG-01 regression — the in-game command cooldown map is module-global
 * and used to grow forever (one entry per `command:player` pair, never
 * pruned). sweepCooldowns() must evict entries older than the largest
 * declared cooldown while keeping entries that could still gate a call.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../src/bot/logWatcher/logWatcher.js", () => ({
  registerLogCommand: vi.fn(),
}));
vi.mock("../../src/core/utils/commands/commandPolicy.js", () => ({
  resolveCommandPolicy: vi
    .fn()
    .mockReturnValue({ enabled: true, adminOnly: false }),
}));
vi.mock("../../src/core/utils/stores/linkUtils.js", () => ({
  loadLinkedAccounts: vi.fn().mockResolvedValue({}),
}));
vi.mock("../../src/bot/commands/middleware.js", () => ({
  isServerAdmin: vi.fn().mockReturnValue(false),
}));

import {
  defineCommand,
  sweepCooldowns,
  cooldownStoreSize,
} from "../../src/bot/logWatcher/defineCommand.js";
import { registerLogCommand } from "../../src/bot/logWatcher/logWatcher.js";

describe("defineCommand — cooldown map eviction (BUG-01)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Drain anything earlier suites left behind (module-global map).
    sweepCooldowns(Number.MAX_SAFE_INTEGER);
  });

  async function useCommand(name: string, players: string[], cooldown: number) {
    const handler = vi.fn().mockResolvedValue(undefined);
    const { init } = defineCommand({
      name,
      description: "sweep test",
      cooldown,
      handler,
    });
    init();
    const calls = vi.mocked(registerLogCommand).mock.calls;
    const [regex, registered] = calls[calls.length - 1]!;
    const server = { id: "srv", sendCommand: vi.fn().mockResolvedValue("") };
    for (const player of players) {
      const line = `[12:00:00] [Server thread/INFO]: <${player}> !${name}`;
      const match = (regex as RegExp).exec(line)!;
      await registered(match, {} as never, server as never);
    }
  }

  it("evicts entries older than the largest cooldown, keeps live ones", async () => {
    await useCommand("sweepa", ["Alice", "Bob", "Carol"], 60);
    expect(cooldownStoreSize()).toBe(3);

    // Not stale yet — inside the 60s horizon nothing may be removed.
    expect(sweepCooldowns(Date.now() + 30_000)).toBe(0);
    expect(cooldownStoreSize()).toBe(3);

    // Far past every declared cooldown — everything goes.
    const removed = sweepCooldowns(Date.now() + 24 * 60 * 60 * 1000);
    expect(removed).toBe(3);
    expect(cooldownStoreSize()).toBe(0);
  });

  it("stays bounded across many unique command:player pairs", async () => {
    const players = Array.from({ length: 50 }, (_, i) => `P${i}`);
    await useCommand("sweepb", players, 5);
    expect(cooldownStoreSize()).toBe(50);
    sweepCooldowns(Date.now() + 24 * 60 * 60 * 1000);
    expect(cooldownStoreSize()).toBe(0);
  });
});
