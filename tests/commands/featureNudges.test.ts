/**
 * The nudge policy. Every rule here exists to stop the feature becoming
 * spam, so they are the part worth pinning: one at a time, only the next
 * step in the funnel, never a feature already in use, and it gives up.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  chooseNudge,
  MAX_NUDGES_PER_FEATURE,
  NUDGE_COOLDOWN_MS,
  type NudgeSettings,
  type PlayerProgress,
} from "../../src/core/utils/minecraft/featureNudges.js";
import type { SuggestionLedger } from "../../src/core/utils/stores/suggestionLedger.js";

const settings: NudgeSettings = {
  enabled: true,
  maxPerFeature: MAX_NUDGES_PER_FEATURE,
  cooldownMs: NUDGE_COOLDOWN_MS,
};

const emptyStore = (): SuggestionLedger => ({ version: 1, subjects: {} });

const storeWith = (
  player: string,
  kind: "link" | "daily",
  count: number,
  lastAt: number,
): SuggestionLedger => ({
  version: 1,
  subjects: { [`mc:${player.toLowerCase()}`]: { [kind]: { count, lastAt } } },
});

const NEW_PLAYER: PlayerProgress = { linked: false, hasClaimedDaily: false };
const LINKED: PlayerProgress = { linked: true, hasClaimedDaily: false };
const ONBOARDED: PlayerProgress = { linked: true, hasClaimedDaily: true };

describe("chooseNudge — funnel order", () => {
  it("tells an unlinked player about link, not daily", () => {
    // /daily requires a linked account, so mentioning it first would be
    // advertising something the player cannot use.
    expect(chooseNudge("Steve", NEW_PLAYER, emptyStore(), settings)).toBe("link");
  });

  it("moves on to daily once they are linked", () => {
    expect(chooseNudge("Steve", LINKED, emptyStore(), settings)).toBe("daily");
  });

  it("says nothing to a player already using both", () => {
    expect(chooseNudge("Steve", ONBOARDED, emptyStore(), settings)).toBeNull();
  });

  it("never returns more than one feature — the caller gets a single kind", () => {
    // Structural, but it is the whole anti-decision-fatigue premise: the
    // return type cannot express a list.
    const result = chooseNudge("Steve", NEW_PLAYER, emptyStore(), settings);
    expect(typeof result).toBe("string");
  });
});

describe("chooseNudge — restraint", () => {
  const now = 1_700_000_000_000;

  it("respects the cooldown", () => {
    const store = storeWith("Steve", "link", 1, now - 1_000);
    expect(chooseNudge("Steve", NEW_PLAYER, store, settings, now)).toBeNull();
  });

  it("nudges again once the cooldown has passed", () => {
    const store = storeWith("Steve", "link", 1, now - NUDGE_COOLDOWN_MS - 1);
    expect(chooseNudge("Steve", NEW_PLAYER, store, settings, now)).toBe("link");
  });

  it("gives up permanently after the limit", () => {
    // Someone told three times and still not linked has decided.
    const store = storeWith("Steve", "link", MAX_NUDGES_PER_FEATURE, 0);
    expect(chooseNudge("Steve", NEW_PLAYER, store, settings, now)).toBeNull();
  });

  it("counts link and daily separately", () => {
    // Having exhausted link nudges must not silence daily once they link.
    const store = storeWith("Steve", "link", MAX_NUDGES_PER_FEATURE, now);
    expect(chooseNudge("Steve", LINKED, store, settings, now)).toBe("daily");
  });

  it("matches the player case-insensitively", () => {
    const store = storeWith("steve", "link", MAX_NUDGES_PER_FEATURE, 0);
    expect(chooseNudge("SteVe", NEW_PLAYER, store, settings, now)).toBeNull();
  });

  it("says nothing at all when disabled", () => {
    expect(
      chooseNudge("Steve", NEW_PLAYER, emptyStore(), {
        ...settings,
        enabled: false,
      }),
    ).toBeNull();
  });

  it("honours a stricter configured limit", () => {
    const store = storeWith("Steve", "link", 1, 0);
    expect(
      chooseNudge("Steve", NEW_PLAYER, store, { ...settings, maxPerFeature: 1 }),
    ).toBeNull();
  });
});
