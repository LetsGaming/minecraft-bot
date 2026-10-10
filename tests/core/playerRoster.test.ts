import { describe, it, expect } from "vitest";
import {
  buildRoster,
  filterInactive,
  sortRoster,
  type RosterEntry,
} from "../../src/core/utils/minecraft/playerRoster.js";
import type { PlayerSessionEntry } from "../../src/core/utils/stores/sessionStore.js";

const DAY = 86_400_000;
const NOW = 1_700_000_000_000;

function session(
  name: string,
  lastSeen: number | null,
  open = false,
): PlayerSessionEntry {
  return {
    name,
    lastSeen,
    sessions: open
      ? [{ joinedAt: NOW - 1000, leftAt: null }]
      : lastSeen
        ? [{ joinedAt: lastSeen - 1000, leftAt: lastSeen }]
        : [],
  };
}

describe("buildRoster", () => {
  it("unions stats uuids, known players and session-only players", () => {
    const roster = buildRoster({
      statsPlaytime: { "aaaa-bbbb": 100, cccc: 50 },
      known: [
        { uuid: "AAAABBBB", name: "Alice" },
        { uuid: "dddd", name: "Dora" },
      ],
      sessions: { eve: session("Eve", NOW - DAY) },
    });
    expect(roster.map((r) => r.name).sort()).toEqual(
      ["Alice", "Dora", "Eve", "cccc"].sort(),
    );
    const alice = roster.find((r) => r.name === "Alice")!;
    expect(alice.playtimeTicks).toBe(100);
    expect(alice.uuid).toBe("aaaabbbb");
    expect(roster.find((r) => r.name === "Eve")!.uuid).toBeNull();
    expect(roster.find((r) => r.name === "Dora")!.playtimeTicks).toBeNull();
  });

  it("joins sessions by lowercased name and adopts the session casing", () => {
    const roster = buildRoster({
      statsPlaytime: { a: 1 },
      known: [{ uuid: "a", name: "STEVE" }],
      sessions: { steve: session("Steve", NOW - 5, false) },
    });
    expect(roster).toHaveLength(1);
    expect(roster[0]).toMatchObject({ name: "Steve", lastSeen: NOW - 5, online: false });
  });

  it("marks players with an open session as online", () => {
    const roster = buildRoster({
      statsPlaytime: {},
      known: [{ uuid: "a", name: "Bob" }],
      sessions: { bob: session("Bob", null, true) },
    });
    expect(roster[0]!.online).toBe(true);
  });
});

function e(name: string, over: Partial<RosterEntry> = {}): RosterEntry {
  return { uuid: name, name, online: false, lastSeen: null, playtimeTicks: null, ...over };
}

describe("sortRoster", () => {
  const entries = [
    e("old", { lastSeen: NOW - 10 * DAY, playtimeTicks: 5 }),
    e("untrackedBig", { playtimeTicks: 900 }),
    e("recent", { lastSeen: NOW - DAY, playtimeTicks: 1 }),
    e("untrackedSmall", { playtimeTicks: 10 }),
    e("on", { online: true, playtimeTicks: 2 }),
  ];

  it("last-seen: online, then recent activity, then untracked by playtime", () => {
    expect(sortRoster(entries, "last-seen").map((r) => r.name)).toEqual([
      "on",
      "recent",
      "old",
      "untrackedBig",
      "untrackedSmall",
    ]);
  });

  it("playtime: highest first", () => {
    expect(sortRoster(entries, "playtime").map((r) => r.name)[0]).toBe("untrackedBig");
  });

  it("name: case-insensitive alphabetical", () => {
    const sorted = sortRoster([e("bob"), e("Alice"), e("carl")], "name");
    expect(sorted.map((r) => r.name)).toEqual(["Alice", "bob", "carl"]);
  });

  it("does not mutate the input", () => {
    const copy = [...entries];
    sortRoster(entries, "name");
    expect(entries).toEqual(copy);
  });
});

describe("filterInactive", () => {
  const entries = [
    e("on", { online: true }),
    e("recent", { lastSeen: NOW - 2 * DAY }),
    e("stale", { lastSeen: NOW - 40 * DAY }),
    e("unknown"),
  ];

  it("keeps only players older than the cutoff and drops unknown by default", () => {
    expect(filterInactive(entries, 30, false, NOW).map((r) => r.name)).toEqual(["stale"]);
  });

  it("includes unknown activity when requested, never online players", () => {
    expect(filterInactive(entries, 30, true, NOW).map((r) => r.name)).toEqual([
      "stale",
      "unknown",
    ]);
  });
});
