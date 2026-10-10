import { describe, expect, it } from "vitest";
import { en } from "@mcbot/core/locales/en.js";
import { de } from "@mcbot/core/locales/de.js";

const placeholders = (value: string | undefined): string =>
  [...(value ?? "").matchAll(/\{(\w+)\}/g)]
    .map((m) => m[1])
    .sort()
    .join(",");

describe("locale placeholders", () => {
  it("uses the same {placeholders} in every locale for each key", () => {
    const mismatched = Object.entries(en)
      .filter(([key, value]) => placeholders(value) !== placeholders(de[key]))
      .map(([key]) => key);
    expect(mismatched).toEqual([]);
  });
});
