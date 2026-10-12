/**
 * Characterization tests for /watch, the watch firer, /clear-dm and /profile.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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

const getAuditEntry = vi.fn();
vi.mock("../../src/core/utils/stores/whitelistAudit.js", () => ({
  getAuditEntry: (n: string) => getAuditEntry(n) as unknown,
}));

const loadLinked = vi.fn();
vi.mock("../../src/core/utils/stores/linkUtils.js", async () => {
  const actual = await vi.importActual<
    typeof import("../../src/core/utils/stores/linkUtils.js")
  >("../../src/core/utils/stores/linkUtils.js");
  return {
    ...actual,
    loadLinkedAccountsOrEmpty: () => loadLinked() as unknown,
  };
});

import { execute as watchExecute } from "../../src/bot/commands/general/watch.js";
import { execute as clearDmExecute } from "../../src/bot/commands/general/clearDm.js";
import { execute as profileExecute } from "../../src/bot/commands/info/profile.js";
import { fireWatches } from "../../src/bot/logWatcher/watchers/watchFirer.js";
import {
  loadWatchStore,
  saveWatchStore,
  MAX_WATCHES_PER_USER,
  type Watch,
} from "../../src/core/utils/stores/watchStore.js";
import { kvSet } from "../../src/core/db/kv.js";
import { closeDbForTesting } from "../../src/core/db/index.js";
import type { Client } from "discord.js";

type Opts = Record<string, string | number | boolean | undefined>;
function interaction(sub: string | null, opts: Opts = {}, extra: object = {}) {
  return {
    user: { id: "u1", tag: "user#1" },
    client: { user: { id: "bot" } },
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
      getBoolean: (name: string) => (opts[name] as boolean | undefined) ?? null,
    },
    editReply: vi.fn().mockResolvedValue(undefined),
    ...extra,
  };
}
const run = (fn: unknown, i: unknown) =>
  (fn as (i: unknown) => Promise<void>)(i);
function embedText(i: { editReply: ReturnType<typeof vi.fn> }): string {
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
  getAuditEntry.mockReset().mockResolvedValue(null);
  loadLinked.mockReset().mockResolvedValue({});
});

function watch(overrides: Partial<Watch> = {}): Watch {
  return {
    id: "w1",
    userId: "u1",
    kind: "server",
    serverId: "smp",
    createdAt: 1,
    ...overrides,
  };
}
const seedWatches = (...watches: Watch[]) =>
  saveWatchStore({ version: 1, watches });

describe("/watch", () => {
  it("server: subscribes once and refuses a duplicate", async () => {
    await run(watchExecute, interaction("server"));
    expect((await loadWatchStore()).watches).toMatchObject([
      { userId: "u1", kind: "server", serverId: "smp" },
    ]);
    await expect(run(watchExecute, interaction("server"))).rejects.toThrow();
    expect((await loadWatchStore()).watches).toHaveLength(1);
  });

  it("player: stores the lowercased name, rejects invalid names and duplicates", async () => {
    await expect(
      run(watchExecute, interaction("player", { player: "no good!" })),
    ).rejects.toThrow();

    await run(watchExecute, interaction("player", { player: " SteVe " }));
    expect((await loadWatchStore()).watches[0]).toMatchObject({
      kind: "player",
      player: "steve",
      serverId: "smp",
    });
    await expect(
      run(watchExecute, interaction("player", { player: "STEVE" })),
    ).rejects.toThrow();
  });

  it("allows a server watch and a player watch on the same server", async () => {
    await run(watchExecute, interaction("server"));
    await run(watchExecute, interaction("player", { player: "Steve" }));
    expect((await loadWatchStore()).watches).toHaveLength(2);
  });

  it("caps subscriptions per user, counting only the caller's own", async () => {
    await seedWatches(
      ...Array.from({ length: MAX_WATCHES_PER_USER }, (_, n) =>
        watch({ id: `w${n}`, kind: "player", player: `p${n}` }),
      ),
    );
    await expect(run(watchExecute, interaction("server"))).rejects.toThrow();

    const other = interaction("server");
    other.user = { id: "u2", tag: "user#2" };
    await run(watchExecute, other);
    expect((await loadWatchStore()).watches).toHaveLength(MAX_WATCHES_PER_USER + 1);
  });

  it("list: shows only the caller's watches, or a placeholder", async () => {
    const empty = interaction("list");
    await run(watchExecute, empty);
    expect(embedText(empty)).toBeTruthy();

    await seedWatches(
      watch({ id: "mine" }),
      watch({ id: "theirs", userId: "u2" }),
      watch({ id: "pl", kind: "player", player: "steve" }),
    );
    const i = interaction("list");
    await run(watchExecute, i);
    const text = embedText(i);
    expect(text).toContain("mine");
    expect(text).toContain("pl");
    expect(text).not.toContain("theirs");
  });

  it("remove: deletes only the caller's own watch", async () => {
    await seedWatches(watch({ id: "mine" }), watch({ id: "theirs", userId: "u2" }));
    await expect(
      run(watchExecute, interaction("remove", { id: "theirs" })),
    ).rejects.toThrow();
    await run(watchExecute, interaction("remove", { id: " mine " }));
    expect((await loadWatchStore()).watches.map((w) => w.id)).toEqual(["theirs"]);
  });
});

describe("fireWatches", () => {
  const send = vi.fn();
  const client = {
    users: { fetch: vi.fn() },
  };
  beforeEach(() => {
    send.mockReset().mockResolvedValue(undefined);
    client.users.fetch.mockReset().mockResolvedValue({ send });
  });
  const flush = () => new Promise((r) => setTimeout(r, 20));

  it("DMs each matching subscriber once and consumes the watch", async () => {
    await seedWatches(
      watch({ id: "a", userId: "u1" }),
      watch({ id: "b", userId: "u2" }),
      watch({ id: "c", serverId: "other" }),
    );
    fireWatches(client as unknown as Client, { kind: "server", serverId: "smp" });
    await flush();
    expect(send).toHaveBeenCalledTimes(2);
    expect((await loadWatchStore()).watches.map((w) => w.id)).toEqual(["c"]);

    fireWatches(client as unknown as Client, { kind: "server", serverId: "smp" });
    await flush();
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("matches player watches case-insensitively and names the joined player", async () => {
    await seedWatches(
      watch({ id: "p", kind: "player", player: "steve" }),
      watch({ id: "q", kind: "player", player: "alex" }),
    );
    fireWatches(client as unknown as Client, { kind: "player", serverId: "smp", player: "StEvE" });
    await flush();
    expect(send).toHaveBeenCalledTimes(1);
    expect(String(send.mock.calls[0]![0])).toContain("StEvE");
    expect((await loadWatchStore()).watches.map((w) => w.id)).toEqual(["q"]);
  });

  it("still consumes the watch when the DM fails", async () => {
    send.mockRejectedValue(new Error("Cannot send messages to this user"));
    await seedWatches(watch());
    fireWatches(client as unknown as Client, { kind: "server", serverId: "smp" });
    await flush();
    expect((await loadWatchStore()).watches).toHaveLength(0);
  });

  it("never throws into the caller", async () => {
    client.users.fetch.mockRejectedValue(new Error("boom"));
    await seedWatches(watch());
    expect(() =>
      fireWatches(client as unknown as Client, { kind: "server", serverId: "smp" }),
    ).not.toThrow();
    await flush();
  });
});

describe("/clear-dm", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  type Msg = { id: string; author: { id: string }; delete: ReturnType<typeof vi.fn>; cleanContent?: string; createdAt: Date; attachments: { map: (f: (a: { url: string }) => string) => string[] } };
  function msg(id: string, author = "bot", extra: Partial<Msg> = {}): Msg {
    return {
      id,
      author: { id: author },
      delete: vi.fn().mockResolvedValue(undefined),
      cleanContent: `text ${id}`,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      attachments: { map: () => [] },
      ...extra,
    };
  }
  function page(msgs: Msg[]) {
    return { size: msgs.length, last: () => msgs.at(-1), values: () => msgs[Symbol.iterator]() };
  }
  function dmInteraction(pages: Msg[][], opts: Opts = {}) {
    const fetch = vi.fn();
    for (const p of pages) fetch.mockResolvedValueOnce(page(p));
    fetch.mockResolvedValue(page([]));
    const i = interaction(null, opts, {
      user: { id: "u1", createDM: vi.fn().mockResolvedValue({ messages: { fetch } }) },
    });
    return { i, fetch };
  }
  async function exec(i: unknown) {
    const p = run(clearDmExecute, i);
    await vi.runAllTimersAsync();
    await p;
  }

  it("reports when there is nothing to delete", async () => {
    const { i } = dmInteraction([[msg("1", "someone-else")]]);
    await exec(i);
    expect(i.editReply).toHaveBeenCalledTimes(1);
  });

  it("deletes only the bot's own messages and reports the count", async () => {
    const mine = msg("1");
    const theirs = msg("2", "u1");
    const { i } = dmInteraction([[mine, theirs, msg("3")]]);
    await exec(i);
    expect(mine.delete).toHaveBeenCalled();
    expect(theirs.delete).not.toHaveBeenCalled();
    expect(embedText(i)).toContain("2");
  });

  it("respects the amount limit", async () => {
    const msgs = [msg("1"), msg("2"), msg("3")];
    const { i } = dmInteraction([msgs], { amount: 2 });
    await exec(i);
    const deleted = msgs.filter((m) => m.delete.mock.calls.length > 0);
    expect(deleted.map((m) => m.id)).toEqual(["1", "2"]);
  });

  it("pages through history when a page is full", async () => {
    const full = Array.from({ length: 100 }, (_, n) => msg(`a${n}`, "x"));
    const { i, fetch } = dmInteraction([full, [msg("z")]]);
    await exec(i);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1]![0]).toMatchObject({ before: "a99" });
  });

  it("keeps going when a single delete fails", async () => {
    const bad = msg("1");
    bad.delete.mockRejectedValue(new Error("Unknown Message"));
    const good = msg("2");
    const { i } = dmInteraction([[bad, good]]);
    await exec(i);
    expect(good.delete).toHaveBeenCalled();
    expect(embedText(i)).toContain("1");
  });

  it("attaches a transcript, oldest first, only when asked", async () => {
    const newer = msg("2", "bot", { cleanContent: "second" });
    const older = msg("1", "bot", { cleanContent: "" });
    const withBackup = dmInteraction([[newer, older]], { save_history: true });
    await exec(withBackup.i);
    const files = withBackup.i.editReply.mock.calls[0]![0].files as Array<{
      name: string;
      attachment: Buffer;
    }>;
    expect(files[0]!.name).toBe("clear-dm-backup.txt");
    const body = files[0]!.attachment.toString("utf-8");
    expect(body.indexOf("[attachment/embed]")).toBeLessThan(body.indexOf("second"));

    const plain = dmInteraction([[msg("1")]]);
    await exec(plain.i);
    expect(plain.i.editReply.mock.calls[0]![0]).not.toHaveProperty("files");
  });
});

describe("/profile", () => {
  function seedSessions(entry: object) {
    kvSet("sessions", { version: 1, servers: { smp: { steve: entry } } });
  }

  it("falls back to the caller's linked account and fails when there is none", async () => {
    await expect(run(profileExecute, interaction(null))).rejects.toThrow();

    loadLinked.mockResolvedValue({ u1: "Steve" });
    const i = interaction(null);
    await run(profileExecute, i);
    expect(embedText(i)).toContain("Steve");
  });

  it("rejects invalid usernames", async () => {
    await expect(
      run(profileExecute, interaction(null, { player: "no good!" })),
    ).rejects.toThrow();
  });

  it("says nothing is known for a stranger, but still reports they are not linked", async () => {
    const i = interaction(null, { player: "Steve" });
    await run(profileExecute, i);
    const text = embedText(i);
    expect(text).toContain("smp");
    expect(getAuditEntry).toHaveBeenCalledWith("Steve");
  });

  it("combines link, whitelist audit, playtime, last seen and streak", async () => {
    loadLinked.mockResolvedValue({ d9: "steve" });
    getAuditEntry.mockResolvedValue({ addedBy: "Admin#1", addedAt: "2026-01-01 10:00" });
    seedSessions({
      name: "Steve",
      lastSeen: 1_700_000_000_000,
      sessions: [{ joinedAt: 0, leftAt: 3_600_000 }],
    });
    kvSet("claimedDaily", {
      version: 2,
      servers: { smp: { d9: { currentStreak: 4, longestStreak: 9, lastClaim: 1 } } },
    });
    const i = interaction(null, { player: "STEVE" });
    await run(profileExecute, i);
    const text = embedText(i);
    expect(text).toContain("<@d9>");
    expect(text).toContain("Admin#1");
    expect(text).toContain("4");
    expect(text).toContain("9");
    expect(text).toContain("1 h play time");
  });

  it("omits 'whitelisted by' for a player who was later removed", async () => {
    getAuditEntry.mockResolvedValue({
      addedBy: "Admin#1",
      addedAt: "2026-01-01",
      removedBy: "Admin#2",
    });
    const i = interaction(null, { player: "Steve" });
    await run(profileExecute, i);
    expect(embedText(i)).not.toContain("Admin#1");
  });

  it("shows online instead of last seen while a session is open", async () => {
    seedSessions({ name: "Steve", lastSeen: 1_700_000_000_000, sessions: [{ joinedAt: 1000, leftAt: null }] });
    const online = interaction(null, { player: "Steve" });
    await run(profileExecute, online);
    expect(embedText(online)).not.toContain("<t:");

    seedSessions({ name: "Steve", lastSeen: 1_700_000_000_000, sessions: [{ joinedAt: 0, leftAt: 5 }] });
    const offline = interaction(null, { player: "Steve" });
    await run(profileExecute, offline);
    expect(embedText(offline)).toContain("<t:1700000000:R>");
  });

  it("survives a failing audit lookup", async () => {
    getAuditEntry.mockRejectedValue(new Error("db locked"));
    const i = interaction(null, { player: "Steve" });
    await expect(run(profileExecute, i)).resolves.toBeUndefined();
    expect(i.editReply).toHaveBeenCalledTimes(1);
  });
});
