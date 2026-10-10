import { describe, it, expect } from "vitest";
import { en } from "../../src/core/locales/en.js";
import { de } from "../../src/core/locales/de.js";

describe("players locale keys", () => {
  it("exist in both languages", () => {
    const enKeys = Object.keys(en).filter((k) => k.startsWith("players."));
    const deKeys = Object.keys(de).filter((k) => k.startsWith("players."));
    expect(enKeys.length).toBeGreaterThan(0);
    expect(deKeys.sort()).toEqual(enKeys.sort());
  });
});
