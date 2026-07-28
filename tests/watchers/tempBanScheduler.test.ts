import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const sendCommand = vi.fn().mockResolvedValue(undefined);
const getServerInstance = vi.fn();

vi.mock("../../src/core/utils/server/server.js", () => ({
  getServerInstance: (id: string) => getServerInstance(id) as unknown,
}));

const recordAdminAction = vi.fn().mockResolvedValue(undefined);
vi.mock("../../src/core/utils/stores/adminAudit.js", () => ({
  recordAdminAction: (entry: unknown) => recordAdminAction(entry) as unknown,
}));

const loadLinkedAccounts = vi.fn();
vi.mock("../../src/core/utils/stores/linkUtils.js", async () => {
  const actual = await vi.importActual<
    typeof import("../../src/core/utils/stores/linkUtils.js")
  >("../../src/core/utils/stores/linkUtils.js");
  return {
    ...actual,
    loadLinkedAccountsOrEmpty: () => loadLinkedAccounts() as unknown,
  };
});

const removeTempBan = vi.fn().mockResolvedValue(true);
const loadTempBanStore = vi.fn();
vi.mock("../../src/core/utils/stores/tempBanStore.js", async () => {
  // Keep the real pure helpers (tempBanKey, listTempBans); stub the I/O.
  const actual = await vi.importActual<
    typeof import("../../src/core/utils/stores/tempBanStore.js")
  >("../../src/core/utils/stores/tempBanStore.js");
  return {
    ...actual,
    removeTempBan: (serverId: string, player: string) =>
      removeTempBan(serverId, player) as unknown,
    loadTempBanStore: () => loadTempBanStore() as unknown,
  };
});

import {
  armTempBan,
  cancelTempBanTimer,
  expireTempBan,
  startTempBanScheduler,
  _resetStateForTesting,
} from "../../src/bot/logWatcher/watchers/schedulers/tempBanScheduler.js";
import type { TempBan } from "../../src/core/utils/stores/tempBanStore.js";
import type { Client } from "discord.js";

const dmSend = vi.fn().mockResolvedValue(undefined);
const usersFetch = vi.fn().mockResolvedValue({ send: dmSend });
const client = { users: { fetch: (id: string) => usersFetch(id) as unknown } } as unknown as Client;

function ban(overrides: Partial<TempBan> = {}): TempBan {
  return {
    player: "Steve",
    serverId: "survival",
    expiresAt: Date.now() + 60_000,
    bannedAt: Date.now(),
    by: "admin#0001",
    reason: "griefing",
    ...overrides,
  };
}

describe("tempBanScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    getServerInstance.mockReturnValue({ id: "survival", sendCommand });
    loadTempBanStore.mockResolvedValue({ version: 1, bans: {} });
    loadLinkedAccounts.mockResolvedValue({ "111": "Steve" });
    usersFetch.mockResolvedValue({ send: dmSend });
  });

  afterEach(() => {
    _resetStateForTesting();
    vi.useRealTimers();
  });

  it("pardons the player when the ban expires", async () => {
    armTempBan(client, ban({ expiresAt: Date.now() + 60_000 }));

    await vi.advanceTimersByTimeAsync(59_000);
    expect(sendCommand).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(2_000);
    expect(sendCommand).toHaveBeenCalledWith("/pardon Steve");
    expect(removeTempBan).toHaveBeenCalledWith("survival", "Steve");
  });

  it("re-arms in chunks instead of firing early on long bans", async () => {
    const MAX_TIMEOUT_MS = 2 ** 31 - 1;
    armTempBan(client, ban({ expiresAt: Date.now() + MAX_TIMEOUT_MS * 2 }));

    await vi.advanceTimersByTimeAsync(MAX_TIMEOUT_MS + 1);
    expect(sendCommand).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(MAX_TIMEOUT_MS + 1);
    expect(sendCommand).toHaveBeenCalledWith("/pardon Steve");
  });

  it("cancelTempBanTimer stops a pending release (manual /pardon)", async () => {
    armTempBan(client, ban({ expiresAt: Date.now() + 10_000 }));
    cancelTempBanTimer("survival", "steve"); // case-insensitive key

    await vi.advanceTimersByTimeAsync(20_000);
    expect(sendCommand).not.toHaveBeenCalled();
  });

  it("re-banning the same player replaces the pending release", async () => {
    armTempBan(client, ban({ expiresAt: Date.now() + 10_000 }));
    armTempBan(client, ban({ expiresAt: Date.now() + 60_000 }));

    await vi.advanceTimersByTimeAsync(20_000);
    expect(sendCommand).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(45_000);
    expect(sendCommand).toHaveBeenCalledTimes(1);
  });

  it("DMs the linked Discord account when the ban lifts", async () => {
    await expireTempBan(client, ban());

    expect(usersFetch).toHaveBeenCalledWith("111");
    expect(dmSend).toHaveBeenCalledTimes(1);
    expect(String(dmSend.mock.calls[0]?.[0])).toContain("survival");
  });

  it("skips the DM for an unlinked player", async () => {
    loadLinkedAccounts.mockResolvedValue({ "111": "SomeoneElse" });
    await expireTempBan(client, ban());

    expect(usersFetch).not.toHaveBeenCalled();
    expect(sendCommand).toHaveBeenCalledWith("/pardon Steve");
  });

  it("matches the link case-insensitively", async () => {
    loadLinkedAccounts.mockResolvedValue({ "222": "sTeVe" });
    await expireTempBan(client, ban());

    expect(usersFetch).toHaveBeenCalledWith("222");
  });

  it("still pardons when the DM fails (closed DMs)", async () => {
    dmSend.mockRejectedValueOnce(new Error("Cannot send messages to this user"));
    await expect(expireTempBan(client, ban())).resolves.toBeUndefined();

    expect(sendCommand).toHaveBeenCalledWith("/pardon Steve");
    expect(removeTempBan).toHaveBeenCalledWith("survival", "Steve");
  });

  it("drops the entry without pardoning when the server is gone", async () => {
    getServerInstance.mockReturnValue(undefined);
    await expireTempBan(client, ban());

    expect(sendCommand).not.toHaveBeenCalled();
    expect(dmSend).not.toHaveBeenCalled();
    expect(removeTempBan).toHaveBeenCalledWith("survival", "Steve");
  });

  it("releases bans that expired while the bot was down", async () => {
    loadTempBanStore.mockResolvedValue({
      version: 1,
      bans: {
        "survival:steve": ban({ expiresAt: Date.now() - 5_000 }),
        "survival:alex": ban({
          player: "Alex",
          expiresAt: Date.now() + 30_000,
        }),
      },
    });

    startTempBanScheduler(client);
    await vi.advanceTimersByTimeAsync(0);

    expect(sendCommand).toHaveBeenCalledWith("/pardon Steve");
    expect(sendCommand).not.toHaveBeenCalledWith("/pardon Alex");

    await vi.advanceTimersByTimeAsync(31_000);
    expect(sendCommand).toHaveBeenCalledWith("/pardon Alex");
  });
});
