import { describe, it, expect, vi } from "vitest";

const config = { language: "en" as "en" | "de", guilds: {} };
vi.mock("../../src/core/config.js", () => ({ loadConfig: () => config }));

import { plural, pluralCategory, t } from "../../src/core/utils/i18n.js";

describe("plural forms", () => {
  it("picks the CLDR category per language", () => {
    expect(pluralCategory(1, "en")).toBe("one");
    expect(pluralCategory(0, "en")).toBe("other");
    expect(pluralCategory(1, "de")).toBe("one");
    expect(pluralCategory(2, "de")).toBe("other");
  });

  it("plural() follows the effective language", () => {
    config.language = "en";
    expect(plural(1, { one: "session", other: "sessions" })).toBe("session");
    expect(plural(3, { one: "session", other: "sessions" })).toBe("sessions");
  });

  it("t() resolves {count|one|other} with # as the number", () => {
    config.language = "en";
    // A missing key falls back to the key itself, which lets the template be tested directly.
    expect(t("{count|# day|# days} left", { count: 1 })).toBe("1 day left");
    expect(t("{count|# day|# days} left", { count: 4 })).toBe("4 days left");
  });

  it("leaves the pattern alone when the variable is missing", () => {
    expect(t("{count|# day|# days}")).toBe("{count|# day|# days}");
  });
});
