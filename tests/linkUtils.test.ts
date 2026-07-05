/**
 * linkUtils.test.ts — isLinked, getLinkedAccount, loadLinkedAccounts, loadLinkCodes
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/common/utils/utils.js", () => ({
  getRootDir: vi.fn().mockReturnValue("/tmp"),
  loadJson: vi.fn().mockResolvedValue({}),
  saveJson: vi.fn().mockResolvedValue(undefined),
}));

import { loadJson } from "../src/common/utils/utils.js";
import {
  isLinked,
  getLinkedAccount,
  loadLinkedAccounts,
  loadLinkCodes,
} from "../src/common/utils/linkUtils.js";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadJson).mockResolvedValue({});
});

describe("isLinked", () => {
  it("returns false when user has no linked account", async () => {
    vi.mocked(loadJson).mockResolvedValue({});
    expect(await isLinked("user123")).toBe(false);
  });

  it("returns true when user has a linked account", async () => {
    vi.mocked(loadJson).mockResolvedValue({ user123: "Steve" });
    expect(await isLinked("user123")).toBe(true);
  });

  it("returns false for a different user ID", async () => {
    vi.mocked(loadJson).mockResolvedValue({ user123: "Steve" });
    expect(await isLinked("otherid")).toBe(false);
  });
});

describe("getLinkedAccount", () => {
  it("returns null when user is not in the map", async () => {
    vi.mocked(loadJson).mockResolvedValue({});
    expect(await getLinkedAccount("nobody")).toBeNull();
  });

  it("returns the Minecraft username when linked", async () => {
    vi.mocked(loadJson).mockResolvedValue({ discord123: "Notch" });
    expect(await getLinkedAccount("discord123")).toBe("Notch");
  });

  it("propagates loadJson failures instead of reporting 'not linked'", async () => {
    // A corrupt/unreadable store must surface as an error — silently
    // returning null here made the caller treat the user as unlinked and
    // risked overwriting the store with near-empty data on the next save.
    vi.mocked(loadJson).mockRejectedValue(new Error("File corrupt"));
    await expect(getLinkedAccount("user")).rejects.toThrow("File corrupt");
  });
});

describe("loadLinkedAccounts", () => {
  it("returns the map from JSON storage", async () => {
    vi.mocked(loadJson).mockResolvedValue({ user1: "Steve" });
    const result = await loadLinkedAccounts();
    expect(result).toEqual({ user1: "Steve" });
  });
});

describe("loadLinkCodes", () => {
  it("returns the code map from JSON storage", async () => {
    vi.mocked(loadJson).mockResolvedValue({
      CODE1: { discordId: "u1", expires: 9999 },
    });
    const result = await loadLinkCodes();
    expect(result).toHaveProperty("CODE1");
  });
});
