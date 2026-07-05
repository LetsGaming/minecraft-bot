/**
 * Offline daily-claim delivery queue.
 *
 * deliverPendingRewards is tested THROUGH the real give() — a fake
 * ServerInstance answers /give with the "Gave …" confirmation (or not),
 * so the retry-on-unconfirmed-delivery contract is exercised end to end:
 * entries vanish only after every item is confirmed, partial failures
 * keep exactly the undelivered items, and the store survives restarts by
 * construction (plain JSON).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/common/utils/linkUtils.js", () => ({
  isLinked: vi.fn(),
  getLinkedAccount: vi.fn(),
}));
vi.mock("../src/common/utils/playerUtils.js", () => ({
  getOnlinePlayers: vi.fn(),
}));
vi.mock("../src/bot/utils/guildRouter.js", () => ({
  resolveServer: vi.fn(),
}));
vi.mock("../src/bot/utils/embedUtils.js", () => ({
  createErrorEmbed: vi.fn().mockReturnValue({}),
}));
vi.mock("../src/common/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../src/common/config.js", () => ({
  loadConfig: vi.fn().mockReturnValue({ language: "en", guilds: {} }),
  getServerIds: vi.fn().mockReturnValue(["smp"]),
}));
vi.mock("../src/common/utils/utils.js", () => ({
  getRootDir: vi.fn().mockReturnValue("/tmp"),
  loadJson: vi.fn(),
  saveJson: vi.fn().mockResolvedValue(undefined),
}));

import { loadJson, saveJson } from "../src/common/utils/utils.js";
import {
  loadPendingRewards,
  getServerPending,
  MAX_PENDING_PER_PLAYER,
  type PendingRewardsStore,
} from "../src/common/utils/dailyStore.js";
import { deliverPendingRewards } from "../src/bot/commands/connection/daily/daily.js";
import type { ServerInstance } from "../src/common/utils/server.js";

const pendingStore = (
  entries: PendingRewardsStore["servers"],
): PendingRewardsStore => ({ version: 1, servers: entries });

/**
 * Fake RCON server whose `give` answers can be scripted per item name.
 * useRcon: true so give() actually verifies responses — on screen
 * servers give() is optimistic by design (separate test below).
 */
function fakeServer(
  giveResults: Record<string, string | null>,
  useRcon = true,
) {
  const sendCommand = vi.fn((cmd: string) => {
    if (cmd.startsWith("give ")) {
      const name = Object.keys(giveResults).find((n) => cmd.includes(n));
      return Promise.resolve(name !== undefined ? giveResults[name] : null);
    }
    return Promise.resolve("ok");
  });
  return { id: "smp", config: { useRcon }, sendCommand } as unknown as
    ServerInstance & { sendCommand: ReturnType<typeof vi.fn> };
}

beforeEach(() => vi.clearAllMocks());

describe("pending rewards store", () => {
  it("falls back to an empty v1 store and exposes the cap", async () => {
    vi.mocked(loadJson).mockResolvedValue(undefined);
    expect(await loadPendingRewards()).toEqual({ version: 1, servers: {} });
    expect(MAX_PENDING_PER_PLAYER).toBeGreaterThan(0);
  });
});

describe("deliverPendingRewards", () => {
  it("does nothing when the player has no queue", async () => {
    vi.mocked(loadJson).mockResolvedValue(pendingStore({}));
    const server = fakeServer({});
    expect(await deliverPendingRewards(server, "Alice")).toBe(0);
    expect(saveJson).not.toHaveBeenCalled();
  });

  it("delivers confirmed items, clears the queue, and tells the player", async () => {
    const store = pendingStore({
      smp: {
        alice: [
          {
            discordId: "1",
            queuedAt: 1,
            items: [
              { item: "diamond", amount: 2 },
              { item: "bread", amount: 5 },
            ],
          },
        ],
      },
    });
    vi.mocked(loadJson).mockResolvedValue(store);
    const server = fakeServer({
      diamond: "Gave 2 [Diamond] to Alice",
      bread: "Gave 5 [Bread] to Alice",
    });

    expect(await deliverPendingRewards(server, "Alice")).toBe(2);
    expect(getServerPending(store, "smp")["alice"]).toBeUndefined();
    expect(saveJson).toHaveBeenCalled();
    // Confirmation tellraw went out.
    const tellraw = server.sendCommand.mock.calls.find(([c]: [string]) =>
      c.startsWith("/tellraw Alice"),
    );
    expect(tellraw).toBeTruthy();
  });

  it("keeps exactly the unconfirmed items for the next join (retry)", async () => {
    const store = pendingStore({
      smp: {
        alice: [
          {
            discordId: "1",
            queuedAt: 1,
            items: [
              { item: "diamond", amount: 1 },
              { item: "cursed_item", amount: 1 },
            ],
          },
        ],
      },
    });
    vi.mocked(loadJson).mockResolvedValue(store);
    // diamond confirmed, cursed_item errors server-side (no "Gave").
    const server = fakeServer({
      diamond: "Gave 1 [Diamond] to Alice",
      cursed_item: "Unknown item 'minecraft:cursed_item'",
    });

    expect(await deliverPendingRewards(server, "Alice")).toBe(1);
    const remaining = getServerPending(store, "smp")["alice"]!;
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.items).toEqual([{ item: "cursed_item", amount: 1 }]);
  });

  it("is optimistic on screen servers (give can't be verified) and clears the queue", async () => {
    const store = pendingStore({
      smp: {
        alice: [
          { discordId: "1", queuedAt: 1, items: [{ item: "gold", amount: 1 }] },
        ],
      },
    });
    vi.mocked(loadJson).mockResolvedValue(store);
    // Screen server: sendCommand yields null on success AND failure —
    // give() documents this and returns true, matching the online /daily
    // path's behavior on the same server type.
    const server = fakeServer({ gold: null }, false);

    expect(await deliverPendingRewards(server, "Alice")).toBe(1);
    expect(getServerPending(store, "smp")["alice"]).toBeUndefined();
  });

  it("keeps everything when RCON gives no response (connection dropped)", async () => {
    const store = pendingStore({
      smp: {
        alice: [
          { discordId: "1", queuedAt: 1, items: [{ item: "gold", amount: 1 }] },
        ],
      },
    });
    vi.mocked(loadJson).mockResolvedValue(store);
    const server = fakeServer({ gold: null });

    expect(await deliverPendingRewards(server, "Alice")).toBe(0);
    expect(getServerPending(store, "smp")["alice"]).toHaveLength(1);
    // No "delivered" tellraw when nothing was confirmed.
    const tellraw = server.sendCommand.mock.calls.find(([c]: [string]) =>
      c.startsWith("/tellraw"),
    );
    expect(tellraw).toBeUndefined();
  });

  it("is case-insensitive on the player name key", async () => {
    const store = pendingStore({
      smp: {
        alice: [
          { discordId: "1", queuedAt: 1, items: [{ item: "iron", amount: 1 }] },
        ],
      },
    });
    vi.mocked(loadJson).mockResolvedValue(store);
    const server = fakeServer({ iron: "Gave 1 [Iron Ingot] to ALICE" });

    expect(await deliverPendingRewards(server, "ALICE")).toBe(1);
    expect(getServerPending(store, "smp")["alice"]).toBeUndefined();
  });
});
