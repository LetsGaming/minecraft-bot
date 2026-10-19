/**
 * Typed owners for the kv rows the bot used to open-code. The stored shapes
 * and keys must stay byte-compatible with existing databases, so each test
 * seeds the raw row the old code wrote and reads it back through the store.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { kvGet, kvSet } from "../../src/core/db/kv.js";
import { closeDbForTesting } from "../../src/core/db/index.js";
import {
  loadStatusMessages,
  updateStatusMessages,
  statusChannelsFor,
} from "../../src/core/utils/stores/statusMessagesStore.js";
import {
  loadWhitelistApplications,
  updateWhitelistApplications,
  MAX_DECIDED_APPLICATIONS,
  type WhitelistApplication,
} from "../../src/core/utils/stores/whitelistApplicationStore.js";
import {
  loadConsoleRelayState,
  updateConsoleRelayState,
  setConsoleRelayEnabled,
} from "../../src/core/utils/stores/consoleRelayStore.js";
import {
  loadMilestoneState,
  updateMilestoneState,
} from "../../src/core/utils/stores/milestoneStore.js";
import {
  lastNotifiedVersion,
  recordNotifiedVersion,
} from "../../src/core/utils/stores/updateNotifierStore.js";
import {
  loadLeaderboardSchedule,
  recordLeaderboardPost,
} from "../../src/core/utils/stores/leaderboardScheduleStore.js";

beforeEach(() => {
  closeDbForTesting();
});

describe("statusMessagesStore", () => {
  const channels = {
    categoryId: "cat",
    textChannelId: "text",
    messageId: "msg",
    voiceChannelId: "voice",
  };

  it("reads the row the status embed wrote under the same key", () => {
    expect(loadStatusMessages()).toEqual({});
    expect(statusChannelsFor("g1")).toBeNull();
    kvSet("statusMessages", { g1: channels });
    expect(statusChannelsFor("g1")).toEqual(channels);
    expect(statusChannelsFor("g2")).toBeNull();
  });

  it("updates one guild without touching the others", () => {
    kvSet("statusMessages", { g1: channels });
    updateStatusMessages((state) => {
      state["g2"] = { ...channels, messageId: "other" };
    });
    expect(kvGet("statusMessages")).toEqual({
      g1: channels,
      g2: { ...channels, messageId: "other" },
    });
  });

  it("does not resolve inherited keys as guilds", () => {
    expect(statusChannelsFor("constructor")).toBeNull();
    expect(statusChannelsFor("__proto__")).toBeNull();
  });

  it("treats a malformed row as empty", () => {
    kvSet("statusMessages", "oops");
    expect(loadStatusMessages()).toEqual({});
  });
});

describe("whitelistApplicationStore", () => {
  const app = (id: string, over: Partial<WhitelistApplication> = {}): WhitelistApplication => ({
    id,
    guildId: "g1",
    userId: "u1",
    userTag: "user#1",
    mcName: "Steve",
    serverId: "smp",
    status: "pending",
    createdAt: Number(id.replace(/\D/g, "")) || 0,
    ...over,
  });

  it("fills the missing parts of a partial row", () => {
    expect(loadWhitelistApplications()).toEqual({ version: 1, prompts: {}, applications: [] });
    kvSet("whitelistApplications", { prompts: { g1: { channelId: "c", messageId: "m" } } });
    expect(loadWhitelistApplications()).toEqual({
      version: 1,
      prompts: { g1: { channelId: "c", messageId: "m" } },
      applications: [],
    });
  });

  it("applies changes to the stored document and returns the callback result", () => {
    updateWhitelistApplications((store) => {
      store.applications.push(app("a1"));
    });
    const count = updateWhitelistApplications((store) => {
      store.applications.push(app("a2"));
      return store.applications.length;
    });
    expect(count).toBe(2);
    expect(loadWhitelistApplications().applications.map((a) => a.id)).toEqual(["a1", "a2"]);
  });

  it("trims decided history but never a pending application", () => {
    updateWhitelistApplications((store) => {
      store.applications.push(app("p1", { createdAt: 1 }));
      for (let n = 0; n < MAX_DECIDED_APPLICATIONS + 10; n++) {
        store.applications.push(
          app(`d${n}`, { status: "approved", createdAt: 100 + n, decidedAt: 100 + n }),
        );
      }
    });
    const { applications } = loadWhitelistApplications();
    expect(applications).toHaveLength(MAX_DECIDED_APPLICATIONS + 1);
    expect(applications.some((a) => a.id === "p1")).toBe(true);
    expect(applications.some((a) => a.id === "d0")).toBe(false);
    expect(applications.some((a) => a.id === `d${MAX_DECIDED_APPLICATIONS + 9}`)).toBe(true);
  });

  it("keeps a decision made during another handler's await", async () => {
    updateWhitelistApplications((store) => {
      store.applications.push(app("a1"), app("a2"));
    });
    await Promise.all([
      (async () => {
        await new Promise((r) => setImmediate(r));
        updateWhitelistApplications((store) => {
          store.applications.find((a) => a.id === "a1")!.status = "approved";
        });
      })(),
      (async () => {
        await new Promise((r) => setImmediate(r));
        updateWhitelistApplications((store) => {
          store.applications.find((a) => a.id === "a2")!.status = "denied";
        });
      })(),
    ]);
    expect(loadWhitelistApplications().applications.map((a) => a.status)).toEqual([
      "approved",
      "denied",
    ]);
  });
});

describe("consoleRelayStore", () => {
  it("reads the old row shape", () => {
    expect(loadConsoleRelayState()).toEqual({ guilds: {} });
    kvSet("consoleRelay", { guilds: { g1: { smp: true } } });
    expect(loadConsoleRelayState()).toEqual({ guilds: { g1: { smp: true } } });
  });

  it("turns the relay on and off per guild and server", () => {
    setConsoleRelayEnabled("g1", "smp", true);
    setConsoleRelayEnabled("g1", "creative", true);
    setConsoleRelayEnabled("g1", "smp", false);
    expect(kvGet("consoleRelay")).toEqual({ guilds: { g1: { creative: true } } });
  });

  it("updateConsoleRelayState returns what the callback returns", () => {
    kvSet("consoleRelay", { guilds: { g1: { smp: true } } });
    expect(updateConsoleRelayState((state) => Object.keys(state.guilds))).toEqual(["g1"]);
  });
});

describe("milestoneStore", () => {
  it("reads the old row shape and fills missing parts", () => {
    expect(loadMilestoneState()).toEqual({ servers: {}, seeded: {} });
    kvSet("milestones", { servers: { smp: { kills: { uuid: 100 } } } });
    expect(loadMilestoneState()).toEqual({
      servers: { smp: { kills: { uuid: 100 } } },
      seeded: {},
    });
  });

  it("persists changes made in an update", () => {
    updateMilestoneState((state) => {
      (state.seeded["smp"] ??= {})["kills"] = true;
    });
    expect(kvGet("milestones")).toEqual({ servers: {}, seeded: { smp: { kills: true } } });
  });
});

describe("updateNotifierStore", () => {
  it("is null before the first notification", () => {
    expect(lastNotifiedVersion()).toBeNull();
  });

  it("stores the version in the old row shape", () => {
    recordNotifiedVersion("8.1.0");
    expect(kvGet("updateNotifier")).toEqual({ lastNotifiedVersion: "8.1.0" });
    expect(lastNotifiedVersion()).toBe("8.1.0");
  });

  it("reads a row written by the previous implementation", () => {
    kvSet("updateNotifier", { lastNotifiedVersion: "7.0.0" });
    expect(lastNotifiedVersion()).toBe("7.0.0");
  });
});

describe("leaderboardScheduleStore", () => {
  it("reads and records a post time per guild", () => {
    expect(loadLeaderboardSchedule()).toEqual({});
    recordLeaderboardPost("g1", 100);
    recordLeaderboardPost("g2", 200);
    recordLeaderboardPost("g1", 300);
    expect(kvGet("leaderboardSchedule")).toEqual({ g1: 300, g2: 200 });
    expect(loadLeaderboardSchedule()).toEqual({ g1: 300, g2: 200 });
  });
});
