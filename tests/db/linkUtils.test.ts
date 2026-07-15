/**
 * linkUtils.test.ts — SQLite-backed link store.
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

import { closeDbForTesting } from "../../src/core/db/index.js";
import {
  isLinked,
  getLinkedAccount,
  loadLinkedAccounts,
  saveLinkedAccounts,
  loadLinkCodes,
  saveLinkCodes,
  issueLinkCode,
  confirmLinkCode,
  unlinkAccount,
} from "../../src/core/utils/stores/linkUtils.js";

beforeEach(() => {
  closeDbForTesting();
});

describe("legacy map API", () => {
  it("round-trips linked accounts through the table", async () => {
    await saveLinkedAccounts({ user1: "Steve", user2: "Alex" });
    expect(await loadLinkedAccounts()).toEqual({
      user1: "Steve",
      user2: "Alex",
    });
  });

  it("saveLinkedAccounts replaces the whole table (old file semantics)", async () => {
    await saveLinkedAccounts({ user1: "Steve" });
    await saveLinkedAccounts({ user2: "Alex" });
    expect(await loadLinkedAccounts()).toEqual({ user2: "Alex" });
  });

  it("round-trips link codes with expiry and confirmed flag", async () => {
    await saveLinkCodes({
      CODE1: { discordId: "u1", expires: 9999, confirmed: false },
      CODE2: { discordId: "u2", expires: 1234, confirmed: true },
    });
    const codes = await loadLinkCodes();
    expect(codes.CODE1).toEqual({
      discordId: "u1",
      expires: 9999,
      confirmed: false,
    });
    expect(codes.CODE2!.confirmed).toBe(true);
  });
});

describe("isLinked / getLinkedAccount", () => {
  it("returns false / null when the user has no link", async () => {
    expect(await isLinked("nobody")).toBe(false);
    expect(await getLinkedAccount("nobody")).toBeNull();
  });

  it("returns the Minecraft username when linked", async () => {
    await saveLinkedAccounts({ discord123: "Notch" });
    expect(await isLinked("discord123")).toBe(true);
    expect(await getLinkedAccount("discord123")).toBe("Notch");
  });
});

describe("issueLinkCode", () => {
  it("issues a fresh code for an unlinked user", async () => {
    const res = await issueLinkCode("u1", "AAAA1111");
    expect(res.status).toBe("issued");
    const codes = await loadLinkCodes();
    expect(codes.AAAA1111!.discordId).toBe("u1");
    expect(codes.AAAA1111!.confirmed).toBe(false);
  });

  it("returns the pending code instead of issuing a second one", async () => {
    await issueLinkCode("u1", "AAAA1111");
    const res = await issueLinkCode("u1", "BBBB2222");
    expect(res).toEqual({ status: "pending", code: "AAAA1111" });
    expect(Object.keys(await loadLinkCodes())).toEqual(["AAAA1111"]);
  });

  it("prunes an expired code and issues a new one", async () => {
    await saveLinkCodes({
      OLD11111: { discordId: "u1", expires: Date.now() - 1, confirmed: false },
    });
    const res = await issueLinkCode("u1", "NEW22222");
    expect(res.status).toBe("issued");
    const codes = await loadLinkCodes();
    expect(codes.OLD11111).toBeUndefined();
    expect(codes.NEW22222).toBeDefined();
  });

  it("reports already-linked from linked_accounts, not code leftovers", async () => {
    await saveLinkedAccounts({ u1: "Steve" });
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
    expect((await loadLinkCodes()).AAAA1111!.confirmed).toBe(true);
  });

  it("returns unknown-code for a code that was never issued", async () => {
    expect(await confirmLinkCode("XXXXXXXX", "Steve")).toEqual({
      status: "unknown-code",
    });
  });

  it("rejects and deletes an expired code", async () => {
    await saveLinkCodes({
      EXP11111: { discordId: "u9", expires: Date.now() - 1, confirmed: false },
    });
    const res = await confirmLinkCode("EXP11111", "Steve");
    expect(res).toEqual({ status: "expired", discordId: "u9" });
    expect((await loadLinkCodes()).EXP11111).toBeUndefined();
    expect(await getLinkedAccount("u9")).toBeNull();
  });

  it("rejects a username already owned by another Discord account (case-insensitive)", async () => {
    await saveLinkedAccounts({ owner: "SteveMC" });
    await issueLinkCode("intruder", "BBBB2222");
    const res = await confirmLinkCode("BBBB2222", "stevemc");
    expect(res).toEqual({ status: "name-taken", discordId: "intruder" });
    expect(await getLinkedAccount("intruder")).toBeNull();
  });

  it("lets the same account relink its own username", async () => {
    await saveLinkedAccounts({ u1: "Steve" });
    await saveLinkCodes({
      RELINK11: { discordId: "u1", expires: Date.now() + 60_000, confirmed: false },
    });
    const res = await confirmLinkCode("RELINK11", "Steve");
    expect(res.status).toBe("linked");
  });
});

describe("unlinkAccount", () => {
  it("removes an existing link and reports true", async () => {
    await saveLinkedAccounts({ u1: "Steve" });
    expect(await unlinkAccount("u1")).toBe(true);
    expect(await getLinkedAccount("u1")).toBeNull();
  });

  it("reports false when there was nothing to remove", async () => {
    expect(await unlinkAccount("ghost")).toBe(false);
  });
});
