import { describe, it, expect, vi } from "vitest";

vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  isNightTick,
  parseSleepTimer,
} from "../../src/bot/logWatcher/watchers/log/sleepWatcher.js";

describe("isNightTick", () => {
  it("is false during the day", () => {
    expect(isNightTick(0)).toBe(false);
    expect(isNightTick(6000)).toBe(false);
    expect(isNightTick(12541)).toBe(false);
  });
  it("is true inside the bed window", () => {
    expect(isNightTick(12542)).toBe(true);
    expect(isNightTick(18000)).toBe(true);
    expect(isNightTick(23459)).toBe(true);
  });
  it("is false after sunrise", () => {
    expect(isNightTick(23460)).toBe(false);
    expect(isNightTick(23999)).toBe(false);
  });
});

describe("parseSleepTimer", () => {
  it("reads the value after the colon", () => {
    expect(parseSleepTimer("Steve has the following entity data: 87s")).toBe(87);
    expect(parseSleepTimer("Steve has the following entity data: 0s")).toBe(0);
  });
  it("ignores digits followed by s inside the player name", () => {
    expect(parseSleepTimer("xX_99s_Xx has the following entity data: 0s")).toBe(0);
  });
  it("reads an unparseable reply as 0", () => {
    expect(parseSleepTimer("No entity was found")).toBe(0);
  });
});
