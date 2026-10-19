/**
 * Snapshots of event notifications (join, leave, death, advancement,
 * challenge) for an English and a German guild, from real log lines through
 * the real watchers, broadcaster and embed builders.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { NOW, SNAPSHOT_CONFIG, fixturePath, renderMessage, stringify } from "./render.js";

vi.mock("../../../src/core/config.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  loadConfig: () => SNAPSHOT_CONFIG,
}));
vi.mock("../../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../../src/bot/utils/guild/guildRouter.js", () => ({
  serverInScope: vi.fn().mockReturnValue(true),
}));
vi.mock("../../../src/core/utils/server/server.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getAllInstances: () => [{ id: "smp" }],
}));
vi.mock("../../../src/core/utils/stores/sessionStore.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  openSession: vi.fn(),
  closeSession: vi.fn().mockReturnValue(true),
  openSession: vi.fn(),
  closeSession: vi.fn(),
}));
vi.mock("../../../src/core/utils/minecraft/rewards.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  deliverPendingRewards: vi.fn().mockResolvedValue(0),
  give: vi.fn().mockResolvedValue(true),
}));
vi.mock("../../../src/core/utils/minecraft/featureNudges.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  maybeNudge: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../../src/core/utils/minecraft/eventTips.js", () => ({
  tipForEvent: vi.fn().mockResolvedValue(false),
  deliverEventTip: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../../src/bot/logWatcher/watchers/watchFirer.js", () => ({ fireWatches: vi.fn() }));
vi.mock("../../../src/core/utils/stores/challengeStore.js", () => ({
  updateChallengeStore: vi.fn((fn: (store: object) => unknown) => fn({})),
  expireStale: vi.fn().mockReturnValue(false),
  getActiveChallenge: vi.fn(() => ({
    advancement: "How Did We Get Here?",
    status: "active",
    reward: "a diamond block",
  })),
}));
vi.mock("../../../src/core/utils/stores/adminAudit.js", () => ({
  recordAdminAction: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../../src/core/utils/minecraft/serverMessages.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  tellraw: vi.fn().mockResolvedValue(undefined),
}));

import { registerJoinLeaveWatcher } from "../../../src/bot/logWatcher/watchers/log/joinLeave.js";
import { registerDeathWatcher } from "../../../src/bot/logWatcher/watchers/log/deaths.js";
import { registerAdvancementWatcher } from "../../../src/bot/logWatcher/watchers/log/advancements.js";
import { flushSendQueues } from "../../../src/bot/logWatcher/watchers/sendQueue.js";

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"], now: NOW });
});
afterAll(() => {
  vi.useRealTimers();
});

const LINES = {
  join: "[14:50:00] [Server thread/INFO]: Nils_Builds joined the game",
  leave: "[14:50:10] [Server thread/INFO]: Nils_Builds left the game",
  death: "[14:50:20] [Server thread/INFO]: creeperchen was blown up by Creeper",
  advancement: "[14:50:30] [Server thread/INFO]: ikarus_77 has made the advancement [Diamonds!]",
  challenge:
    "[14:50:40] [Server thread/INFO]: Marlene_B has completed the challenge [How Did We Get Here?]",
};

describe("Discord snapshots: event notifications", () => {
  it("renders each event for an English and a German guild", async () => {
    const handlers: Array<[RegExp, (m: RegExpMatchArray, c: unknown, s: unknown) => Promise<void>]> = [];
    const server = {
      id: "smp",
      getLastDeathLocation: vi.fn().mockResolvedValue({ ok: false }),
      getSeed: vi.fn().mockResolvedValue({ ok: false }),
      getList: vi
        .fn()
        .mockResolvedValue({ ok: true, value: { playerCount: "1", maxPlayers: "20", players: [] } }),
    };
    const watcher = {
      server,
      register: (regex: RegExp, handler: (typeof handlers)[number][1]) => {
        handlers.push([regex, handler]);
      },
    };
    let current: Array<Record<string, unknown>> = [];
    const client = {
      channels: {
        fetch: async (id: string) => ({
          send: async (payload: unknown) => {
            current.push(renderMessage(`channel.send to the ${id} guild`, payload));
          },
        }),
      },
    };
    const guilds = {
      "g-en": { notifications: { channelId: "en", events: ["join", "leave", "death", "advancement", "challenge"] } },
      "g-de": { notifications: { channelId: "de", events: ["join", "leave", "death", "advancement", "challenge"] } },
    };
    registerJoinLeaveWatcher(watcher as never, client as never, guilds as never);
    registerDeathWatcher(watcher as never, client as never, guilds as never);
    registerAdvancementWatcher(watcher as never, client as never, guilds as never);

    const out: Record<string, unknown> = {};
    for (const [event, line] of Object.entries(LINES)) {
      current = [];
      for (const [regex, handler] of handlers) {
        const match = line.match(regex);
        if (match) await handler(match, client, server);
      }
      await flushSendQueues();
      out[event] = current;
    }
    await expect(stringify(out)).toMatchFileSnapshot(fixturePath("events"));
  });
});
