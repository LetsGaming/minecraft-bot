/**
 * linkStore.test.ts — SQLite-backed link store.
 *
 * Legacy map API (loadLinkedAccounts & co.) plus the atomic operations
 * (issueLinkCode / confirmLinkCode / unlinkAccount) that closed the
 * load-modify-save races. Runs against a real in-memory database
 * (MCBOT_DB_PATH=":memory:" from tests/setup.ts); closing the handle
 * between tests drops it.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { closeDbForTesting, getDb } from "../../src/core/db/index.js";
import {
  isLinked,
  getLinkedAccount,
  loadLinkedAccounts,
  issueLinkCode,
  confirmLinkCode,
  unlinkAccount,
  findDiscordIdByMcName,
} from "../../src/core/utils/stores/linkStore.js";

beforeEach(() => {
  closeDbForTesting();
});

function seedLinks(map: Record<string, string>): void {
  const insert = getDb().prepare(
    "INSERT INTO linked_accounts (discord_id, mc_name) VALUES (?, ?)",
  );
  for (const [discordId, mcName] of Object.entries(map)) insert.run(discordId, mcName);
}

function saveLinkCodes(
  codes: Record<string, { discordId: string; expires: number; confirmed: boolean }>,
): void {
  const insert = getDb().prepare(
    "INSERT INTO link_codes (code, discord_id, expires, confirmed) VALUES (?, ?, ?, ?)",
  );
  for (const [code, e] of Object.entries(codes)) {
    insert.run(code, e.discordId, e.expires, e.confirmed ? 1 : 0);
  }
}

function loadLinkCodes(): Record<string, { discordId: string; confirmed: boolean }> {
  const rows = getDb()
    .prepare("SELECT code, discord_id, confirmed FROM link_codes")
    .all() as { code: string; discord_id: string; confirmed: number }[];
  return Object.fromEntries(
    rows.map((r) => [r.code, { discordId: r.discord_id, confirmed: r.confirmed === 1 }]),
  );
}

describe("map API", () => {
  it("round-trips linked accounts through the table", async () => {
    seedLinks({ user1: "Steve", user2: "Alex" });
    expect(await loadLinkedAccounts()).toEqual({
      user1: "Steve",
      user2: "Alex",
    });
  });
});

describe("isLinked / getLinkedAccount", () => {
  it("returns false / null when the user has no link", async () => {
    expect(await isLinked("nobody")).toBe(false);
    expect(await getLinkedAccount("nobody")).toBeNull();
  });

  it("returns the Minecraft username when linked", async () => {
    seedLinks({ discord123: "Notch" });
    expect(await isLinked("discord123")).toBe(true);
    expect(await getLinkedAccount("discord123")).toBe("Notch");
  });
});

describe("issueLinkCode", () => {
  it("issues a fresh code for an unlinked user", async () => {
    const res = await issueLinkCode("u1", "AAAA1111");
    expect(res.status).toBe("issued");
    const codes = loadLinkCodes();
    expect(codes.AAAA1111!.discordId).toBe("u1");
    expect(codes.AAAA1111!.confirmed).toBe(false);
  });

  it("returns the pending code instead of issuing a second one", async () => {
    await issueLinkCode("u1", "AAAA1111");
    const res = await issueLinkCode("u1", "BBBB2222");
    expect(res).toEqual({ status: "pending", code: "AAAA1111" });
    expect(Object.keys(loadLinkCodes())).toEqual(["AAAA1111"]);
  });

  it("prunes an expired code and issues a new one", async () => {
    saveLinkCodes({
      OLD11111: { discordId: "u1", expires: Date.now() - 1, confirmed: false },
    });
    const res = await issueLinkCode("u1", "NEW22222");
    expect(res.status).toBe("issued");
    const codes = loadLinkCodes();
    expect(codes.OLD11111).toBeUndefined();
    expect(codes.NEW22222).toBeDefined();
  });

  it("reports already-linked from linked_accounts, not code leftovers", async () => {
    seedLinks({ u1: "Steve" });
    const res = await issueLinkCode("u1", "CCCC3333");
    expect(res).toEqual({ status: "already-linked" });
    // Regression for the old flow: after unlink the user must be able to
    // relink (the JSON version kept a confirmed-code tombstone forever).
    await unlinkAccount("u1");
    const res2 = await issueLinkCode("u1", "DDDD4444");
    expect(res2.status).toBe("issued");
  });
});

describe("confirmLinkCode", () => {
  it("links on a valid code and marks it confirmed", async () => {
    await issueLinkCode("u1", "AAAA1111");
    const res = await confirmLinkCode("AAAA1111", "Steve");
    expect(res).toEqual({ status: "linked", discordId: "u1" });
    expect(await getLinkedAccount("u1")).toBe("Steve");
    expect(loadLinkCodes().AAAA1111!.confirmed).toBe(true);
  });

  it("returns unknown-code for a code that was never issued", async () => {
    expect(await confirmLinkCode("XXXXXXXX", "Steve")).toEqual({
      status: "unknown-code",
    });
  });

  it("rejects and deletes an expired code", async () => {
    saveLinkCodes({
      EXP11111: { discordId: "u9", expires: Date.now() - 1, confirmed: false },
    });
    const res = await confirmLinkCode("EXP11111", "Steve");
    expect(res).toEqual({ status: "expired", discordId: "u9" });
    expect(loadLinkCodes().EXP11111).toBeUndefined();
    expect(await getLinkedAccount("u9")).toBeNull();
  });

  it("rejects a username already owned by another Discord account (case-insensitive)", async () => {
    seedLinks({ owner: "SteveMC" });
    await issueLinkCode("intruder", "BBBB2222");
    const res = await confirmLinkCode("BBBB2222", "stevemc");
    expect(res).toEqual({ status: "name-taken", discordId: "intruder" });
    expect(await getLinkedAccount("intruder")).toBeNull();
  });

  it("rejects a code that was already confirmed and keeps the first link", async () => {
    await issueLinkCode("u1", "ONCE1111");
    expect((await confirmLinkCode("ONCE1111", "Steve")).status).toBe("linked");
    const replay = await confirmLinkCode("ONCE1111", "Mallory");
    expect(replay).toEqual({ status: "already-used" });
    expect(await getLinkedAccount("u1")).toBe("Steve");
  });

  it("never rebinds an already linked Discord account to another name", async () => {
    seedLinks({ u1: "Steve" });
    saveLinkCodes({
      REBIND11: { discordId: "u1", expires: Date.now() + 60_000, confirmed: false },
    });
    expect(await confirmLinkCode("REBIND11", "Alex")).toEqual({ status: "already-used" });
    expect(await getLinkedAccount("u1")).toBe("Steve");
  });

  it("lets the same account relink its own username", async () => {
    seedLinks({ u1: "Steve" });
    saveLinkCodes({
      RELINK11: { discordId: "u1", expires: Date.now() + 60_000, confirmed: false },
    });
    const res = await confirmLinkCode("RELINK11", "Steve");
    expect(res.status).toBe("linked");
  });
});

describe("unlinkAccount", () => {
  it("removes an existing link and reports true", async () => {
    seedLinks({ u1: "Steve" });
    expect(await unlinkAccount("u1")).toBe(true);
    expect(await getLinkedAccount("u1")).toBeNull();
  });

  it("reports false when there was nothing to remove", async () => {
    expect(await unlinkAccount("ghost")).toBe(false);
  });
});

describe("findDiscordIdByMcName", () => {
  const linked = { u1: "Steve", u2: "Alex" };

  it("finds the owner of a name", () => {
    expect(findDiscordIdByMcName(linked, "Alex")).toBe("u2");
  });

  it("ignores casing, since log lines and /link input can disagree", () => {
    expect(findDiscordIdByMcName(linked, "sTeVe")).toBe("u1");
  });

  it("returns null for an unlinked name and an empty map", () => {
    expect(findDiscordIdByMcName(linked, "Herobrine")).toBeNull();
    expect(findDiscordIdByMcName({}, "Steve")).toBeNull();
  });
});
