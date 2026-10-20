import { describe, expect, it } from "vitest";
import { isKeyActive } from "../../src/web/frontend/src/components/schema/configuredFirst";
import { configGroups, guildConfigGroups } from "../../src/web/frontend/src/components/schema/configGroups";

const none = new Set<string>();

describe("isKeyActive", () => {
  it("shows a setting that is saved in the document", () => {
    expect(isKeyActive("language", { language: "en" }, { language: "en" }, none)).toBe(true);
  });

  it("hides a setting that is neither saved nor edited", () => {
    expect(isKeyActive("timezone", {}, {}, none)).toBe(false);
    expect(isKeyActive("timezone", {}, null, none)).toBe(false);
  });

  it("shows a setting edited in this session, so typing never hides the field", () => {
    expect(isKeyActive("timezone", { timezone: "E" }, {}, none)).toBe(true);
  });

  it("keeps a saved setting visible after it is cleared in the draft", () => {
    expect(isKeyActive("timezone", {}, { timezone: "UTC" }, none)).toBe(true);
  });

  it("shows a setting with a problem", () => {
    expect(isKeyActive("port", {}, {}, new Set(["port"]))).toBe(true);
  });
});

describe("guildConfigGroups", () => {
  it("orders tabs by the table and drops empty ones", () => {
    const groups = guildConfigGroups(["commands", "language", "chatBridge", "leaderboard"]);
    expect(groups.map((g) => [g.id, g.keys])).toEqual([
      ["general", ["language"]],
      ["chat", ["chatBridge"]],
      ["leaderboard", ["leaderboard"]],
      ["commands", ["commands"]],
    ]);
  });

  it("puts a key the table does not name in Other", () => {
    expect(guildConfigGroups(["language", "futureThing"]).map((g) => g.id)).toEqual(["general", "other"]);
  });
});

describe("configGroups", () => {
  it("no longer has a Guilds group", () => {
    expect(configGroups(["token", "guilds"]).some((g) => g.id === "guilds")).toBe(false);
  });
});
