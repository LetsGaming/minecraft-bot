/**
 * Characterization tests for the admin /note and /challenge commands:
 * input validation, state changes in the stores, audit records and the
 * lazy expiry of stale challenges.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../src/bot/commands/middleware.js", () => ({
  withErrorHandling: <T>(fn: T) => fn,
  requireServerAdmin: <T>(fn: T) => fn,
}));

const smp = { id: "smp" };
vi.mock("../../src/bot/utils/guild/guildRouter.js", () => ({
  resolveServer: () => smp,
}));

const findPlayer = vi.fn();
vi.mock("../../src/core/utils/minecraft/playerUtils.js", () => ({
  findPlayer: (...a: unknown[]) => findPlayer(...a) as unknown,
}));

const recordAdminAction = vi.fn();
vi.mock("../../src/core/utils/stores/adminAudit.js", () => ({
  recordAdminAction: (e: unknown) => recordAdminAction(e) as unknown,
}));

const broadcastNotification = vi.fn();
vi.mock("../../src/bot/logWatcher/watchers/notifyGuilds.js", () => ({
  broadcastNotification: (...a: unknown[]) => broadcastNotification(...a) as unknown,
}));

vi.mock("../../src/core/config.js", () => ({
  loadConfig: () => ({ guilds: { g1: {} } }),
}));

const tellraw = vi.fn();
vi.mock("../../src/core/utils/minecraft/serverMessages.js", () => ({
  tellraw: (...a: unknown[]) => tellraw(...a) as unknown,
}));

import { execute as noteExecute } from "../../src/bot/commands/admin/note.js";
import { execute as challengeExecute } from "../../src/bot/commands/admin/challenge.js";
import {
  loadNotesStore,
  updateNotesStore,
  addNote,
  MAX_NOTES_PER_PLAYER,
} from "../../src/core/utils/stores/noteStore.js";
import {
  loadChallengeStore,
  updateChallengeStore,
  addChallenge,
  MAX_CHALLENGE_HISTORY,
  type Challenge,
} from "../../src/core/utils/stores/challengeStore.js";
import { closeDbForTesting } from "../../src/core/db/index.js";

type Opts = Record<string, string | number | undefined>;
function interaction(sub: string, opts: Opts = {}) {
  return {
    guild: { id: "g1" },
    user: { id: "admin1", tag: "admin#1" },
    client: { id: "client" },
    options: {
      getSubcommand: () => sub,
      getString: (name: string, required?: boolean) => {
        const v = opts[name];
        if (v === undefined) {
          if (required) throw new Error(`missing ${name}`);
          return null;
        }
        return String(v);
      },
      getInteger: (name: string) => (opts[name] as number | undefined) ?? null,
    },
    editReply: vi.fn().mockResolvedValue(undefined),
  };
}
const run = (fn: unknown, i: unknown) =>
  (fn as (i: unknown) => Promise<void>)(i);

function replyText(i: ReturnType<typeof interaction>): string {
  const e = i.editReply.mock.calls[0]![0].embeds[0].toJSON() as {
    title?: string;
    description?: string;
    footer?: { text: string };
  };
  return `${e.title ?? ""}\n${e.description ?? ""}\n${e.footer?.text ?? ""}`;
}

beforeEach(() => {
  closeDbForTesting();
  vi.clearAllMocks();
  findPlayer.mockReset().mockResolvedValue({ uuid: "uuid-1", name: "Steve" });
  recordAdminAction.mockReset().mockResolvedValue(undefined);
  broadcastNotification.mockReset().mockResolvedValue(undefined);
  tellraw.mockReset().mockResolvedValue(true);
});

async function seedNotes(count = 1, uuid = "uuid-1", name = "Steve") {
  await updateNotesStore((store) => {
    for (let n = 1; n <= count; n++) {
      addNote(store, uuid, name, {
        text: `note ${n}`,
        author: "mod#1",
        authorId: "m1",
        createdAt: "2026-01-01 10:00",
      });
    }
  });
}

describe("/note", () => {
  it("rejects an invalid Minecraft name before touching anything", async () => {
    await expect(
      run(noteExecute, interaction("add", { player: "bad name!", text: "x" })),
    ).rejects.toThrow();
    expect(findPlayer).not.toHaveBeenCalled();
  });

  it("add: stores a trimmed note under the resolved UUID and audits it", async () => {
    const i = interaction("add", { player: "steve", text: "  griefed spawn  " });
    await run(noteExecute, i);

    const entry = (await loadNotesStore()).players["uuid-1"]!;
    expect(entry.name).toBe("Steve");
    expect(entry.notes).toHaveLength(1);
    expect(entry.notes[0]).toMatchObject({
      text: "griefed spawn",
      author: "admin#1",
      authorId: "admin1",
    });
    expect(recordAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "note add",
        detail: "Steve: griefed spawn",
      }),
    );
    expect(i.editReply).toHaveBeenCalledTimes(1);
  });

  it("add: truncates to 300 characters", async () => {
    await run(noteExecute, interaction("add", { player: "Steve", text: "x".repeat(400) }));
    expect((await loadNotesStore()).players["uuid-1"]!.notes[0]!.text).toHaveLength(300);
  });

  it("add: refuses a blank note and a player nobody knows", async () => {
    await expect(
      run(noteExecute, interaction("add", { player: "Steve", text: "   " })),
    ).rejects.toThrow();

    findPlayer.mockResolvedValue(null);
    await expect(
      run(noteExecute, interaction("add", { player: "Ghost", text: "hi" })),
    ).rejects.toThrow();
    expect((await loadNotesStore()).players).toEqual({});
  });

  it("add: treats a failing player lookup like an unknown player", async () => {
    findPlayer.mockRejectedValue(new Error("rcon down"));
    await expect(
      run(noteExecute, interaction("add", { player: "Steve", text: "hi" })),
    ).rejects.toThrow();
  });

  it("add: keeps only the newest 25 notes", async () => {
    await seedNotes(MAX_NOTES_PER_PLAYER);
    await run(noteExecute, interaction("add", { player: "Steve", text: "newest" }));
    const notes = (await loadNotesStore()).players["uuid-1"]!.notes;
    expect(notes).toHaveLength(MAX_NOTES_PER_PLAYER);
    expect(notes.at(-1)!.text).toBe("newest");
    expect(notes[0]!.text).toBe("note 2");
  });

  it("list: renders numbered notes and the count footer", async () => {
    await seedNotes(2);
    const i = interaction("list", { player: "Steve" });
    await run(noteExecute, i);
    const text = replyText(i);
    expect(text).toContain("**1.** [2026-01-01 10:00] mod#1: note 1");
    expect(text).toContain("**2.**");
    expect(text).toContain(`2`);
  });

  it("list: errors when the player has no notes", async () => {
    await expect(run(noteExecute, interaction("list", { player: "Steve" }))).rejects.toThrow();
  });

  it("list: falls back to the stored name for a player the server no longer knows", async () => {
    await seedNotes(1, "uuid-9", "OldName");
    findPlayer.mockResolvedValue(null);
    const i = interaction("list", { player: "oldname" });
    await run(noteExecute, i);
    expect(replyText(i)).toContain("note 1");
  });

  it("remove: deletes by 1-based index, audits, and drops the empty player entry", async () => {
    await seedNotes(2);
    await run(noteExecute, interaction("remove", { player: "Steve", index: 1 }));
    let store = await loadNotesStore();
    expect(store.players["uuid-1"]!.notes.map((n) => n.text)).toEqual(["note 2"]);

    await run(noteExecute, interaction("remove", { player: "Steve", index: 1 }));
    store = await loadNotesStore();
    expect(store.players["uuid-1"]).toBeUndefined();
    expect(recordAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: "note remove", detail: "Steve: #1" }),
    );
  });

  it("remove: out-of-range index and unknown player change nothing", async () => {
    await seedNotes(1);
    await expect(
      run(noteExecute, interaction("remove", { player: "Steve", index: 5 })),
    ).rejects.toThrow();
    findPlayer.mockResolvedValue(null);
    await expect(
      run(noteExecute, interaction("remove", { player: "Ghost", index: 1 })),
    ).rejects.toThrow();
    expect((await loadNotesStore()).players["uuid-1"]!.notes).toHaveLength(1);
    expect(recordAdminAction).not.toHaveBeenCalled();
  });
});

function challenge(overrides: Partial<Challenge> = {}): Challenge {
  return {
    advancement: "minecraft:story/mine_diamond",
    startedBy: "mod#1",
    startedById: "m1",
    startedAt: Date.now() - 1000,
    status: "active",
    ...overrides,
  };
}
function seedChallenge(...list: Challenge[]) {
  updateChallengeStore((store) => {
    for (const c of list) addChallenge(store, "smp", c);
  });
}
async function challenges(): Promise<Challenge[]> {
  return (await loadChallengeStore()).servers["smp"] ?? [];
}

describe("/challenge start", () => {
  it("creates an active challenge, audits, broadcasts and announces in-game", async () => {
    const i = interaction("start", {
      advancement: " minecraft:story/mine_diamond ",
      reward: "Bragging rights",
      item: "diamond",
      amount: 3,
      duration: 2,
    });
    await run(challengeExecute, i);

    const [c] = await challenges();
    expect(c).toMatchObject({
      advancement: "minecraft:story/mine_diamond",
      reward: "Bragging rights",
      item: "diamond",
      amount: 3,
      status: "active",
      startedById: "admin1",
    });
    expect(c!.endsAt! - c!.startedAt).toBe(2 * 3_600_000);
    expect(recordAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: "challenge start", server: "smp" }),
    );
    expect(broadcastNotification).toHaveBeenCalledWith(
      i.client,
      { g1: {} },
      expect.objectContaining({ serverId: "smp", event: "challenge" }),
    );
    expect(tellraw).toHaveBeenCalledTimes(1);
    expect(i.editReply).toHaveBeenCalledTimes(1);
    expect(replyText(i)).toContain("Item bonus: 3 × Diamond");
  });

  it("omits optional fields and the end time when not given", async () => {
    await run(challengeExecute, interaction("start", { advancement: "adv" }));
    const [c] = await challenges();
    expect(c).not.toHaveProperty("reward");
    expect(c).not.toHaveProperty("item");
    expect(c).not.toHaveProperty("amount");
    expect(c).not.toHaveProperty("endsAt");
  });

  it("refuses to start while one is active, even if another expired in the meantime", async () => {
    await seedChallenge(challenge({ advancement: "old", endsAt: Date.now() - 10 }));
    await seedChallenge(challenge({ advancement: "live" }));
    await expect(
      run(challengeExecute, interaction("start", { advancement: "new" })),
    ).rejects.toThrow();
    const list = await challenges();
    expect(list.map((c) => c.status)).toEqual(["expired", "active"]);
    expect(broadcastNotification).not.toHaveBeenCalled();
  });

  it("an expired challenge no longer blocks a new one", async () => {
    await seedChallenge(challenge({ endsAt: Date.now() - 10 }));
    await run(challengeExecute, interaction("start", { advancement: "new" }));
    expect((await challenges()).map((c) => c.status)).toEqual(["expired", "active"]);
  });

  it("keeps only the newest 20 challenges per server", async () => {
    await seedChallenge(
      ...Array.from({ length: MAX_CHALLENGE_HISTORY }, (_, n) =>
        challenge({ advancement: `a${n}`, status: "won" }),
      ),
    );
    await run(challengeExecute, interaction("start", { advancement: "latest" }));
    const list = await challenges();
    expect(list).toHaveLength(MAX_CHALLENGE_HISTORY);
    expect(list[0]!.advancement).toBe("a1");
    expect(list.at(-1)!.advancement).toBe("latest");
  });
});

describe("/challenge status", () => {
  it("errors when the server never had a challenge", async () => {
    await expect(run(challengeExecute, interaction("status"))).rejects.toThrow();
  });

  it("shows the active challenge, or the latest one when none is active", async () => {
    await seedChallenge(challenge({ advancement: "first", status: "won", wonBy: "Alex" }));
    const i = interaction("status");
    await run(challengeExecute, i);
    expect(replyText(i)).toContain("first");
    expect(replyText(i)).toContain("Alex");

    await seedChallenge(challenge({ advancement: "second" }));
    const j = interaction("status");
    await run(challengeExecute, j);
    expect(replyText(j)).toContain("second");
  });

  it("names an item bonus without an amount by its display name only", async () => {
    await seedChallenge(challenge({ item: "minecraft:cooked_beef" }));
    const i = interaction("status");
    await run(challengeExecute, i);
    expect(replyText(i)).toContain("Item bonus: Cooked Beef\n");
    expect(replyText(i)).not.toContain("cooked_beef");
  });

  it("persists the lazy expiry it noticed", async () => {
    await seedChallenge(challenge({ endsAt: Date.now() - 10 }));
    await run(challengeExecute, interaction("status"));
    expect((await challenges())[0]!.status).toBe("expired");
  });
});

describe("/challenge cancel", () => {
  it("cancels the active challenge and audits", async () => {
    await seedChallenge(challenge());
    await run(challengeExecute, interaction("cancel"));
    expect((await challenges())[0]!.status).toBe("cancelled");
    expect(recordAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "challenge cancel",
        detail: "minecraft:story/mine_diamond",
      }),
    );
  });

  it("errors when nothing is active but still records an expiry it noticed", async () => {
    await expect(run(challengeExecute, interaction("cancel"))).rejects.toThrow();
    await seedChallenge(challenge({ endsAt: Date.now() - 10 }));
    await expect(run(challengeExecute, interaction("cancel"))).rejects.toThrow();
    expect((await challenges())[0]!.status).toBe("expired");
    expect(recordAdminAction).not.toHaveBeenCalled();
  });
});
