/**
 * Event tips, and the rule that runs through every tip path: a command the
 * operator disabled is never advertised.
 *
 * That last one was a real bug — the join nudge, the follow-up hints and
 * the death DM all recommended commands without checking whether they were
 * switched on, so a server with `daily` disabled still told every new
 * player to run it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockConfig: Record<string, unknown> = {};
vi.mock("../../src/core/config.js", () => ({ loadConfig: () => mockConfig }));
vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../src/core/utils/i18n.js", () => ({ t: (key: string) => key }));

const ledger = { version: 1 as const, subjects: {} as Record<string, unknown> };
vi.mock("../../src/core/utils/stores/suggestionLedger.js", async () => {
  const actual = await vi.importActual<
    typeof import("../../src/core/utils/stores/suggestionLedger.js")
  >("../../src/core/utils/stores/suggestionLedger.js");
  return {
    ...actual,
    loadSuggestionLedger: () => Promise.resolve(ledger),
    recordSuggestion: vi.fn().mockResolvedValue(undefined),
  };
});

import {
  tipForEvent,
  deliverEventTip,
  isAdvertisable,
  EVENT_TIPS,
  DEFAULT_MAX_MENTIONS,
} from "../../src/core/utils/minecraft/eventTips.js";

const CTX = { player: "Steve", serverId: "survival" };

beforeEach(() => {
  for (const k of Object.keys(mockConfig)) delete mockConfig[k];
  ledger.subjects = {};
  vi.clearAllMocks();
});

describe("isAdvertisable", () => {
  it("allows a command with no overrides", () => {
    expect(isAdvertisable("deathpos")).toBe(true);
  });

  it("refuses a globally disabled command", () => {
    mockConfig.commands = { report: { enabled: false } };
    expect(isAdvertisable("report")).toBe(false);
  });

  it("refuses a command disabled for just this server", () => {
    mockConfig.servers = { survival: { commands: { report: { enabled: false } } } };
    expect(isAdvertisable("report", { serverId: "survival" })).toBe(false);
    expect(isAdvertisable("report", { serverId: "creative" })).toBe(true);
  });

  it("refuses a command disabled for just this guild", () => {
    mockConfig.guilds = { "1": { commands: { activity: { enabled: false } } } };
    expect(isAdvertisable("activity", { guildId: "1" })).toBe(false);
    expect(isAdvertisable("activity", { guildId: "2" })).toBe(true);
  });

  it("hides an admin-only command from ordinary players", () => {
    // Following the tip would land them on a permission error.
    mockConfig.commands = { console: { adminOnly: true } };
    expect(isAdvertisable("console", {}, false)).toBe(false);
    expect(isAdvertisable("console", {}, true)).toBe(true);
  });
});

describe("tipForEvent", () => {
  it("suggests !deathpos after an ordinary death", async () => {
    const result = await tipForEvent("death", CTX);
    expect(result?.tip.id).toBe("deathpos");
  });

  it("suggests !report after a player kill, not the deathpos tip", async () => {
    // Kept separate so someone who dies to mobs all week never sees it,
    // and a PvP death does not spend a deathpos mention.
    const result = await tipForEvent("death-by-player", CTX);
    expect(result?.tip.id).toBe("report-pvp");
  });

  it("says nothing when the command it would advertise is disabled", async () => {
    mockConfig.servers = {
      survival: { commands: { deathpos: { enabled: false } } },
    };
    expect(await tipForEvent("death", CTX)).toBeNull();
  });

  it("stops after the mention limit", async () => {
    ledger.subjects = {
      "mc:steve": { deathpos: { count: DEFAULT_MAX_MENTIONS, lastAt: 0 } },
    };
    expect(await tipForEvent("death", CTX)).toBeNull();
  });

  it("respects an explicit dismissal whatever the count", async () => {
    ledger.subjects = {
      "mc:steve": { deathpos: { count: 0, lastAt: 0, dismissed: true } },
    };
    expect(await tipForEvent("death", CTX)).toBeNull();
  });

  it("counts per player, not globally", async () => {
    ledger.subjects = {
      "mc:steve": { deathpos: { count: DEFAULT_MAX_MENTIONS, lastAt: 0 } },
    };
    expect(await tipForEvent("death", { ...CTX, player: "Alex" })).not.toBeNull();
  });
});

describe("deliverEventTip", () => {
  it("whispers the tip to the player, in game", async () => {
    // The point of the whole change: this used to ride along on the death
    // DM, which only linked players receive — so a tip about an in-game
    // command never reached the players who had not linked.
    const sendCommand = vi.fn().mockResolvedValue(undefined);
    const tip = await deliverEventTip(
      { id: "survival", sendCommand },
      "death",
      "Steve",
    );

    expect(tip?.id).toBe("deathpos");
    expect(sendCommand).toHaveBeenCalledWith(
      expect.stringContaining("/msg Steve"),
    );
  });

  it("sends nothing when no tip applies", async () => {
    mockConfig.commands = { deathpos: { enabled: false } };
    const sendCommand = vi.fn().mockResolvedValue(undefined);
    expect(
      await deliverEventTip({ id: "survival", sendCommand }, "death", "Steve"),
    ).toBeNull();
    expect(sendCommand).not.toHaveBeenCalled();
  });

  it("does not spend a mention when the whisper fails", async () => {
    const sendCommand = vi.fn().mockRejectedValue(new Error("server down"));
    const { recordSuggestion } = await import(
      "../../src/core/utils/stores/suggestionLedger.js"
    );

    expect(
      await deliverEventTip({ id: "survival", sendCommand }, "death", "Steve"),
    ).toBeNull();
    expect(vi.mocked(recordSuggestion)).not.toHaveBeenCalled();
  });
});

describe("the registry", () => {
  it("has unique ids — they key the ledger", () => {
    const ids = EVENT_TIPS.map((tip) => tip.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("names a command for every tip, so the policy check has something to ask about", () => {
    for (const tip of EVENT_TIPS) {
      expect(tip.advertises.length).toBeGreaterThan(0);
      expect(tip.textKey.length).toBeGreaterThan(0);
    }
  });

  it("only advertises in-game commands that exist in game", () => {
    // A tip declaring surface "ingame" for a Discord-only command would
    // tell players to type something the server has never heard of.
    const inGameCommands = new Set([
      "chunkbase", "commands", "deathpos", "link", "netherportal",
      "playerhead", "report", "seed", "slime", "vote", "waypoint", "waypoints",
    ]);
    for (const tip of EVENT_TIPS) {
      if (tip.surface === "ingame") {
        expect(inGameCommands.has(tip.advertises)).toBe(true);
      }
    }
  });
});
