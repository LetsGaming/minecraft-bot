/**
 * Offline daily-claim delivery queue.
 *
 * deliverPendingRewards is tested THROUGH the real give(): ServerInstance.send
 * answers /give with the "Gave …" confirmation (or not), so the
 * retry-on-unconfirmed-delivery contract is exercised end to end: entries
 * vanish only after every item is confirmed, partial failures keep exactly
 * the undelivered items, and the store survives restarts by construction
 * (kv_store["pendingRewards"] in SQLite).
 *
 * A reward turns on the difference between a send with no reply channel
 * (delivered, unverifiable) and a command that never reached the server
 * (retry), which is exactly what the CommandOutcome union keeps apart.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/core/utils/stores/linkUtils.js", () => ({
  isLinked: vi.fn(),
  getLinkedAccount: vi.fn(),
}));
vi.mock("../../src/core/utils/minecraft/playerUtils.js", () => ({
  getOnlinePlayers: vi.fn(),
}));
vi.mock("../../src/bot/utils/guild/guildRouter.js", () => ({
  resolveServer: vi.fn(),
}));
vi.mock("../../src/bot/utils/embeds/embedUtils.js", () => ({
  createErrorEmbed: vi.fn().mockReturnValue({}),
}));
vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../src/core/config.js", () => ({
  loadConfig: vi.fn().mockReturnValue({ language: "en", guilds: {} }),
  getServerIds: vi.fn().mockReturnValue(["smp"]),
}));
vi.mock("../../src/core/utils/jsonStore.js", () => ({
  loadJson: vi.fn(),
  saveJson: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/core/utils/paths.js", () => ({
  getRootDir: vi.fn().mockReturnValue("/tmp"),
}));

import { kvSet } from "../../src/core/db/kv.js";
import { closeDbForTesting } from "../../src/core/db/index.js";
import {
  loadPendingRewards,
  getServerPending,
  MAX_PENDING_PER_PLAYER,
  type PendingRewardsStore,
} from "../../src/core/utils/stores/dailyStore.js";
import { deliverPendingRewards } from "../../src/core/utils/minecraft/rewards.js";
import type { ServerInstance } from "../../src/core/utils/server/server.js";

const pendingStore = (
  entries: PendingRewardsStore["servers"],
): PendingRewardsStore => ({ version: 1, servers: entries });

/**
 * Fake RCON server whose `give` answers can be scripted per item name.
 * useRcon: true so give() actually verifies responses — on screen
 * servers give() is optimistic by design (separate test below).
 */
/**
 * A server whose wrapper answers `give` per item.
 *
 * A string is the console's reply. `null` is a send with no output channel
 * (screen). An Error value stands in for a command that never reached the
 * server.
 */
function fakeServer(giveResults: Record<string, string | null | Error>) {
  const send = vi.fn((cmd: string) => {
    if (cmd.startsWith("give ")) {
      const name = Object.keys(giveResults).find((n) => cmd.includes(n));
      const r = name !== undefined ? giveResults[name] : null;
      if (r instanceof Error) {
        return Promise.resolve({
          kind: "unreachable",
          reason: "wrapper-down",
          detail: r.message,
        });
      }
      return Promise.resolve(
        r === null || r === undefined
          ? { kind: "sent", via: "screen" }
          : { kind: "delivered", output: r },
      );
    }
    return Promise.resolve({ kind: "delivered", output: "" });
  });
  return { id: "smp", config: { apiUrl: "http://w:3030", apiKey: "k" }, send } as unknown as
    ServerInstance & { send: ReturnType<typeof vi.fn> };
}

beforeEach(() => {
  vi.clearAllMocks();
  closeDbForTesting(); // fresh in-memory DB per test
});

describe("pending rewards store", () => {
  it("falls back to an empty v1 store and exposes the cap", async () => {
    expect(await loadPendingRewards()).toEqual({ version: 1, servers: {} });
    expect(MAX_PENDING_PER_PLAYER).toBeGreaterThan(0);
  });
});

describe("deliverPendingRewards", () => {
  it("does nothing when the player has no queue", async () => {
    kvSet("pendingRewards", pendingStore({}));
    const server = fakeServer({});
    expect(await deliverPendingRewards(server, "Alice")).toBe(0);
    expect(await loadPendingRewards()).toEqual(pendingStore({}));
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
    kvSet("pendingRewards", store);
    const server = fakeServer({
      diamond: "Gave 2 [Diamond] to Alice",
      bread: "Gave 5 [Bread] to Alice",
    });

    expect(await deliverPendingRewards(server, "Alice")).toBe(2);
    const after = await loadPendingRewards();
    expect(getServerPending(after, "smp")["alice"]).toBeUndefined();
    // Confirmation tellraw went out.
    const tellraw = server.send.mock.calls.find(([c]: [string]) =>
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
    kvSet("pendingRewards", store);
    // diamond confirmed, cursed_item errors server-side (no "Gave").
    const server = fakeServer({
      diamond: "Gave 1 [Diamond] to Alice",
      cursed_item: "Unknown item 'minecraft:cursed_item'",
    });

    expect(await deliverPendingRewards(server, "Alice")).toBe(1);
    const after = await loadPendingRewards();
    const remaining = getServerPending(after, "smp")["alice"]!;
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.items).toEqual([{ item: "cursed_item", amount: 1 }]);
  });

  it("clears the queue when the wrapper has no output channel", async () => {
    const store = pendingStore({
      smp: {
        alice: [
          { discordId: "1", queuedAt: 1, items: [{ item: "gold", amount: 1 }] },
        ],
      },
    });
    kvSet("pendingRewards", store);
    // A wrapper without RCON reaches the server over screen and answers 200
    // with a null result: the item was sent, there is just nothing to read
    // back. Treating that as a failure would keep the entry queued and hand
    // out a fresh copy on every join. A wrapper that could not be reached at
    // all throws instead — see the next test.
    const server = fakeServer({ gold: null });

    expect(await deliverPendingRewards(server, "Alice")).toBe(1);
    const after = await loadPendingRewards();
    expect(getServerPending(after, "smp")["alice"]).toBeUndefined();
  });

  it("keeps everything when the wrapper cannot be reached", async () => {
    const store = pendingStore({
      smp: {
        alice: [
          { discordId: "1", queuedAt: 1, items: [{ item: "gold", amount: 1 }] },
        ],
      },
    });
    kvSet("pendingRewards", store);
    const server = fakeServer({ gold: new Error("ECONNREFUSED") });

    expect(await deliverPendingRewards(server, "Alice")).toBe(0);
    const after = await loadPendingRewards();
    expect(getServerPending(after, "smp")["alice"]).toHaveLength(1);
    // No "delivered" tellraw when nothing was confirmed.
    const tellraw = server.send.mock.calls.find(([c]: [string]) =>
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
    kvSet("pendingRewards", store);
    const server = fakeServer({ iron: "Gave 1 [Iron Ingot] to ALICE" });

    expect(await deliverPendingRewards(server, "ALICE")).toBe(1);
    const after = await loadPendingRewards();
    expect(getServerPending(after, "smp")["alice"]).toBeUndefined();
  });
});

describe("deliverPendingRewards under concurrency (AUD-005)", () => {
  it("delivers a queue once when two joins overlap", async () => {
    kvSet(
      "pendingRewards",
      pendingStore({
        smp: { alice: [{ discordId: "1", queuedAt: 1, items: [{ item: "diamond", amount: 1 }] }] },
      }),
    );
    const server = fakeServer({ diamond: "Gave 1 [Diamond] to Alice" });
    const [a, b] = await Promise.all([
      deliverPendingRewards(server, "Alice"),
      deliverPendingRewards(server, "Alice"),
    ]);
    expect(a + b).toBe(1);
  });

  it("keeps entries queued for other players while a delivery runs", async () => {
    kvSet(
      "pendingRewards",
      pendingStore({
        smp: { alice: [{ discordId: "1", queuedAt: 1, items: [{ item: "cursed_item", amount: 1 }] }] },
      }),
    );
    const server = fakeServer({ cursed_item: "Unknown item" });
    const { updatePendingRewards } = await import(
      "../../src/core/utils/stores/dailyStore.js"
    );
    // Bob's claim lands while Alice's give is in flight.
    server.send.mockImplementationOnce(async () => {
      await updatePendingRewards((s) => {
        (getServerPending(s, "smp")["bob"] ??= []).push({
          discordId: "2",
          queuedAt: 2,
          items: [{ item: "bread", amount: 1 }],
        });
      });
      return { kind: "delivered", output: "Unknown item" };
    });
    await deliverPendingRewards(server, "Alice");
    const after = getServerPending(await loadPendingRewards(), "smp");
    expect(after["bob"]).toHaveLength(1);
    expect(after["alice"]).toHaveLength(1);
  });
});
