/**
 * The four new JSON stores that are (mostly) pure state on top of
 * loadJson/saveJson: waypoints, admin notes, challenges, polls. Each is
 * tested on its invariants — the ones the commands and watchers rely on.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/core/utils/utils.js", () => ({
  getRootDir: vi.fn().mockReturnValue("/tmp"),
  loadJson: vi.fn(),
  saveJson: vi.fn().mockResolvedValue(undefined),
}));

import { loadJson } from "../src/core/utils/utils.js";
import {
  loadWaypointStore,
  getServerWaypoints,
  isValidWaypointName,
  type WaypointStore,
} from "../src/core/utils/waypointStore.js";
import {
  addNote,
  removeNote,
  getNotesByUuid,
  findNotesByName,
  MAX_NOTES_PER_PLAYER,
  type PlayerNotesStore,
} from "../src/core/utils/noteStore.js";
import {
  expireStale,
  getActiveChallenge,
  getLatestChallenge,
  addChallenge,
  MAX_CHALLENGE_HISTORY,
  type ChallengeStore,
  type Challenge,
} from "../src/core/utils/challengeStore.js";
import {
  savePollStore,
  getOpenPollForServer,
  voterKeyForMc,
  voterKeyForDiscord,
  tallyPoll,
  MAX_CLOSED_POLLS,
  type Poll,
  type PollStore,
} from "../src/core/utils/pollStore.js";

beforeEach(() => vi.clearAllMocks());

// ── waypoints ───────────────────────────────────────────────────────────────

describe("waypointStore", () => {
  it("validates names against the safe charset", () => {
    expect(isValidWaypointName("spawn")).toBe(true);
    expect(isValidWaypointName("Guardian-Farm_2")).toBe(true);
    expect(isValidWaypointName("")).toBe(false);
    expect(isValidWaypointName("a".repeat(25))).toBe(false);
    // These get interpolated into console commands — must stay rejected.
    expect(isValidWaypointName("evil place")).toBe(false);
    expect(isValidWaypointName('x";say pwned')).toBe(false);
    expect(isValidWaypointName("a/b")).toBe(false);
  });

  it("falls back to an empty v1 store on invalid data", async () => {
    vi.mocked(loadJson).mockResolvedValue({ nope: 1 });
    expect(await loadWaypointStore()).toEqual({ version: 1, servers: {} });
  });

  it("getServerWaypoints creates per-server maps lazily", () => {
    const store: WaypointStore = { version: 1, servers: {} };
    getServerWaypoints(store, "smp")["base"] = {
      name: "base",
      dimension: "overworld",
      x: 1,
      y: 2,
      z: 3,
      author: "Alice",
      createdAt: 0,
    };
    expect(store.servers["smp"]!["base"]!.author).toBe("Alice");
    expect(getServerWaypoints(store, "creative")).toEqual({});
  });
});

// ── notes ───────────────────────────────────────────────────────────────────

describe("noteStore", () => {
  const note = (text: string) => ({
    text,
    author: "Admin#1",
    authorId: "1",
    createdAt: "2026-01-01 12:00",
  });

  it("adds, lists, and removes by 1-based index", () => {
    const store: PlayerNotesStore = { version: 1, players: {} };
    addNote(store, "uuid-1", "Alice", note("first"));
    addNote(store, "uuid-1", "alice", note("second"));

    const entry = getNotesByUuid(store, "uuid-1")!;
    expect(entry.notes.map((n) => n.text)).toEqual(["first", "second"]);
    expect(entry.name).toBe("alice"); // last-known casing

    expect(removeNote(store, "uuid-1", 1)).toBe(true);
    expect(getNotesByUuid(store, "uuid-1")!.notes[0]!.text).toBe("second");
    expect(removeNote(store, "uuid-1", 5)).toBe(false);
    // Removing the last note removes the entry entirely.
    expect(removeNote(store, "uuid-1", 1)).toBe(true);
    expect(getNotesByUuid(store, "uuid-1")).toBeNull();
  });

  it("caps notes per player at MAX_NOTES_PER_PLAYER (oldest dropped)", () => {
    const store: PlayerNotesStore = { version: 1, players: {} };
    for (let i = 0; i < MAX_NOTES_PER_PLAYER + 3; i++) {
      addNote(store, "u", "Alice", note(`n${i}`));
    }
    const entry = getNotesByUuid(store, "u")!;
    expect(entry.notes).toHaveLength(MAX_NOTES_PER_PLAYER);
    expect(entry.notes[0]!.text).toBe("n3");
  });

  it("finds entries by last-known name, case-insensitively", () => {
    const store: PlayerNotesStore = { version: 1, players: {} };
    addNote(store, "u9", "SomeGuy", note("hm"));
    expect(findNotesByName(store, "someguy")!.uuid).toBe("u9");
    expect(findNotesByName(store, "nobody")).toBeNull();
  });
});

// ── challenges ──────────────────────────────────────────────────────────────

describe("challengeStore state machine", () => {
  const mk = (over: Partial<Challenge> = {}): Challenge => ({
    advancement: "Stone Age",
    startedBy: "Admin#1",
    startedById: "1",
    startedAt: 1_000,
    status: "active",
    ...over,
  });

  it("expireStale flips only past-deadline active challenges", () => {
    const store: ChallengeStore = { version: 1, servers: {} };
    addChallenge(store, "smp", mk({ endsAt: 5_000 }));
    expect(expireStale(store, "smp", 4_999)).toBe(false);
    expect(getActiveChallenge(store, "smp")).not.toBeNull();

    expect(expireStale(store, "smp", 5_000)).toBe(true);
    expect(getActiveChallenge(store, "smp")).toBeNull();
    expect(getLatestChallenge(store, "smp")!.status).toBe("expired");
    // No endsAt → never expires.
    addChallenge(store, "smp", mk());
    expect(expireStale(store, "smp", 999_999_999)).toBe(false);
    expect(getActiveChallenge(store, "smp")).not.toBeNull();
  });

  it("won/cancelled challenges are not active and don't re-expire", () => {
    const store: ChallengeStore = { version: 1, servers: {} };
    addChallenge(store, "smp", mk({ status: "won", endsAt: 1 }));
    expect(getActiveChallenge(store, "smp")).toBeNull();
    expect(expireStale(store, "smp", 999)).toBe(false);
  });

  it("bounds per-server history at MAX_CHALLENGE_HISTORY", () => {
    const store: ChallengeStore = { version: 1, servers: {} };
    for (let i = 0; i < MAX_CHALLENGE_HISTORY + 4; i++) {
      addChallenge(store, "smp", mk({ status: "cancelled", startedAt: i }));
    }
    expect(store.servers["smp"]).toHaveLength(MAX_CHALLENGE_HISTORY);
    expect(store.servers["smp"]![0]!.startedAt).toBe(4);
  });
});

// ── polls ───────────────────────────────────────────────────────────────────

describe("pollStore", () => {
  const mkPoll = (over: Partial<Poll> = {}): Poll => ({
    id: "p1",
    question: "Border size?",
    options: ["5k", "10k", "20k"],
    guildId: "g",
    channelId: "c",
    messageId: "m",
    serverId: "smp",
    createdBy: "Admin#1",
    createdById: "1",
    createdAt: 1,
    endsAt: 10_000,
    votes: {},
    status: "open",
    ...over,
  });

  it("dedupes in-game votes onto the Discord key for linked players", () => {
    const linked = { "111": "Alice", "222": "Bob" };
    expect(voterKeyForMc("alice", linked)).toBe(voterKeyForDiscord("111"));
    expect(voterKeyForMc("ALICE", linked)).toBe("d:111");
    expect(voterKeyForMc("Stranger", linked)).toBe("m:stranger");
  });

  it("tallies votes and ignores out-of-range indices", () => {
    const poll = mkPoll({
      votes: { "d:1": 0, "d:2": 2, "m:x": 2, "d:old": 99 },
    });
    expect(tallyPoll(poll)).toEqual([1, 0, 2]);
  });

  it("finds the open poll per server only", () => {
    const store: PollStore = {
      version: 1,
      polls: [
        mkPoll({ id: "a", serverId: "smp", status: "closed" }),
        mkPoll({ id: "b", serverId: "creative" }),
        mkPoll({ id: "c", serverId: "smp" }),
      ],
    };
    expect(getOpenPollForServer(store, "smp")!.id).toBe("c");
    expect(getOpenPollForServer(store, "other")).toBeNull();
  });

  it("savePollStore trims closed history but never open polls", async () => {
    const store: PollStore = { version: 1, polls: [] };
    for (let i = 0; i < MAX_CLOSED_POLLS + 5; i++) {
      store.polls.push(
        mkPoll({ id: `closed${i}`, status: "closed", createdAt: i }),
      );
    }
    store.polls.push(mkPoll({ id: "open1", createdAt: 0 }));

    await savePollStore(store);
    expect(store.polls).toHaveLength(MAX_CLOSED_POLLS + 1);
    expect(store.polls.some((p) => p.id === "open1")).toBe(true);
    expect(store.polls.some((p) => p.id === "closed0")).toBe(false);
  });
});
