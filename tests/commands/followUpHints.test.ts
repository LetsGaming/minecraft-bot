/**
 * Follow-up hints: offering the paired feature at the moment someone uses
 * one. The rules that keep this from becoming noise are the ones pinned
 * here — never offer something already enabled, stop after two offers, and
 * treat "no thanks" as permanent.
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
    dismissSuggestion: vi.fn().mockResolvedValue(undefined),
  };
});

const claimedStore = { version: 2 as const, servers: {} as Record<string, unknown> };
vi.mock("../../src/core/utils/stores/dailyStore.js", () => ({
  loadClaimedStore: () => Promise.resolve(claimedStore),
  saveClaimedStore: vi.fn().mockResolvedValue(undefined),
  getServerClaims: (
    store: { servers: Record<string, Record<string, unknown>> },
    serverId: string,
  ) => (store.servers[serverId] ??= {}),
}));

import {
  selectHint,
  hintIsAvailable,
  buildHintRow,
  findHint,
  HINTS,
  MAX_HINT_OFFERS,
} from "../../src/bot/utils/hints/followUps.js";
import { parseHintCustomId } from "../../src/bot/interactions/followUpHints.js";
import type { SuggestionLedger } from "../../src/core/utils/stores/suggestionLedger.js";

const USER = "111";
const SERVER = "survival";

beforeEach(() => {
  for (const k of Object.keys(mockConfig)) delete mockConfig[k];
  ledger.subjects = {};
  claimedStore.servers = {};
});

describe("selectHint", () => {
  it("offers the reminder to someone who just claimed and has none", () => {
    claimedStore.servers = { [SERVER]: { [USER]: { lastClaim: 1 } } };
    return expect(
      selectHint("daily", { userId: USER, serverId: SERVER }),
    ).resolves.toMatchObject({ id: "daily-reminder" });
  });

  it("does not offer a feature the user already has on", async () => {
    // Offering something already enabled reads as the bot not knowing its
    // own state, which costs more trust than the hint could gain.
    claimedStore.servers = { [SERVER]: { [USER]: { lastClaim: 1, remind: true } } };
    expect(await selectHint("daily", { userId: USER, serverId: SERVER })).toBeNull();
  });

  it("offers nothing after a command with no registered pair", async () => {
    expect(await selectHint("uptime", { userId: USER, serverId: SERVER })).toBeNull();
  });

  it("offers the leaderboard mention after /stats", async () => {
    expect(
      await selectHint("stats", { userId: USER, serverId: SERVER }),
    ).toMatchObject({ id: "stats-leaderboard", kind: "mention" });
  });

  it("stays silent when nudges are switched off", async () => {
    mockConfig.featureNudges = { enabled: false };
    expect(await selectHint("daily", { userId: USER, serverId: SERVER })).toBeNull();
  });

  it("is per server — a reminder on one server does not silence another", async () => {
    claimedStore.servers = {
      [SERVER]: { [USER]: { lastClaim: 1, remind: true } },
      creative: { [USER]: { lastClaim: 1 } },
    };
    expect(
      await selectHint("daily", { userId: USER, serverId: "creative" }),
    ).toMatchObject({ id: "daily-reminder" });
  });
});

describe("hintIsAvailable", () => {
  const withRecord = (record: Record<string, unknown>): SuggestionLedger => ({
    version: 1,
    subjects: { [`discord:${USER}`]: { "daily-reminder": record } },
  }) as SuggestionLedger;

  it("allows a hint never offered", () => {
    expect(
      hintIsAvailable({ version: 1, subjects: {} }, USER, "daily-reminder"),
    ).toBe(true);
  });

  it("stops after the offer limit", () => {
    expect(
      hintIsAvailable(
        withRecord({ count: MAX_HINT_OFFERS, lastAt: 0 }),
        USER,
        "daily-reminder",
      ),
    ).toBe(false);
  });

  it("treats an explicit no as permanent, whatever the count", () => {
    expect(
      hintIsAvailable(
        withRecord({ count: 0, lastAt: 0, dismissed: true }),
        USER,
        "daily-reminder",
      ),
    ).toBe(false);
  });
});

describe("hint buttons", () => {
  it("bakes the owner into the customId so bystanders cannot press it", () => {
    const hint = findHint("daily-reminder")!;
    if (hint.kind !== "action") throw new Error("expected an action hint");
    const row = buildHintRow(hint, { userId: USER, serverId: SERVER });
    const ids = row.components.map((c) => c.data.custom_id);
    expect(ids).toEqual([
      `hint:yes:daily-reminder:${SERVER}:${USER}`,
      `hint:no:daily-reminder:${SERVER}:${USER}`,
    ]);
  });

  it("round-trips through the parser", () => {
    expect(parseHintCustomId(`hint:yes:daily-reminder:${SERVER}:${USER}`)).toEqual({
      answer: "yes",
      hintId: "daily-reminder",
      serverId: SERVER,
      userId: USER,
    });
  });

  it("ignores customIds that are not ours", () => {
    expect(parseHintCustomId("wlapp:approve:123")).toBeNull();
    expect(parseHintCustomId("hint:maybe:x:y:z")).toBeNull();
    expect(parseHintCustomId("hint:yes:too:few")).toBeNull();
  });
});

describe("the registry itself", () => {
  it("only registers hints for commands that exist", () => {
    // A hint whose `after` names a command nobody can run is dead code
    // that looks alive. These are the real command names.
    const known = new Set([
      "daily",
      "status",
      "stats",
      "playtime",
      "seed",
      "leaderboard",
      "activity",
    ]);
    for (const hint of HINTS) expect(known.has(hint.after)).toBe(true);
  });

  it("gives every action hint a label and every mention hint text", () => {
    for (const hint of HINTS) {
      if (hint.kind === "action") {
        expect(hint.labelKey.length).toBeGreaterThan(0);
        expect(hint.confirmKey.length).toBeGreaterThan(0);
      } else {
        expect(hint.textKey.length).toBeGreaterThan(0);
      }
    }
  });

  it("has unique ids, since they key the ledger and the customId", () => {
    const ids = HINTS.map((h) => h.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps ids short enough for Discord's 100-char customId limit", () => {
    for (const hint of HINTS) {
      // hint:yes:<id>:<serverId>:<snowflake> — a snowflake is 19 chars.
      expect(`hint:yes:${hint.id}:a-server-id:123456789012345678`.length)
        .toBeLessThan(100);
    }
  });
});
