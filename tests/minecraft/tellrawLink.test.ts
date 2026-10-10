import { describe, it, expect } from "vitest";
import {
  clickFormatForVersion,
  openUrlClick,
} from "../../src/core/utils/minecraft/tellrawLink.js";

describe("clickFormatForVersion", () => {
  it.each([
    ["1.21.5", "modern"],
    ["1.21.6", "modern"],
    ["1.22", "modern"],
    ["1.21.4", "legacy"],
    ["1.21", "legacy"],
    ["1.20.1", "legacy"],
    ["1.8", "legacy"],
    [null, "both"],
    ["", "both"],
    ["snapshot", "both"],
  ])("%s -> %s", (version, expected) => {
    expect(clickFormatForVersion(version)).toBe(expected);
  });
});

describe("openUrlClick", () => {
  const url = "https://example.com/a?b=1&c=2";

  it("legacy uses clickEvent with value", () => {
    expect(openUrlClick(url, "legacy")).toEqual({
      clickEvent: { action: "open_url", value: url },
    });
  });

  it("modern uses click_event with url", () => {
    expect(openUrlClick(url, "modern")).toEqual({
      click_event: { action: "open_url", url },
    });
  });

  it("both carries each key", () => {
    expect(Object.keys(openUrlClick(url, "both")).sort()).toEqual([
      "clickEvent",
      "click_event",
    ]);
  });
});
