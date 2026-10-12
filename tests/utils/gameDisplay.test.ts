import { describe, it, expect } from "vitest";
import { progressBar, milestoneTrack } from "../../src/bot/utils/embeds/gameDisplay.js";

describe("progressBar", () => {
  it("fills proportionally and clamps", () => {
    expect(progressBar(0, 7)).toBe("▱▱▱▱▱▱▱");
    expect(progressBar(3, 7)).toBe("▰▰▰▱▱▱▱");
    expect(progressBar(7, 7)).toBe("▰▰▰▰▰▰▰");
    expect(progressBar(99, 7)).toBe("▰▰▰▰▰▰▰");
    expect(progressBar(-2, 7)).toBe("▱▱▱▱▱▱▱");
  });

  it("handles a zero max", () => {
    expect(progressBar(1, 0, 4)).toBe("▱▱▱▱");
  });
});

describe("milestoneTrack", () => {
  it("marks reached milestones", () => {
    const track = milestoneTrack(7, [3, 7, 14]);
    expect(track).toContain("●");
    expect(track).toContain("○");
    expect(track.split("\n")).toHaveLength(2);
  });

  it("is empty without milestones", () => {
    expect(milestoneTrack(3, [])).toBe("");
  });
});
