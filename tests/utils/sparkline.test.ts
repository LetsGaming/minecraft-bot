import { describe, it, expect } from "vitest";
import { renderSparkline, SPARKLINE_GAP } from "../../src/core/utils/sparkline.js";

describe("renderSparkline", () => {
  it("maps 0 to the lowest glyph and 1 to the highest", () => {
    expect(renderSparkline([0, 1])).toBe("▁█");
  });

  it("renders null as a gap, distinct from zero", () => {
    expect(renderSparkline([null, 0, null])).toBe(`${SPARKLINE_GAP}▁${SPARKLINE_GAP}`);
  });

  it("rounds to the nearest glyph", () => {
    expect(renderSparkline([0.5])).toBe("▅");
    expect(renderSparkline([0.08])).toBe("▂");
    expect(renderSparkline([0.07])).toBe("▁");
  });

  it("clamps values outside 0 to 1", () => {
    expect(renderSparkline([-3, 4])).toBe("▁█");
  });

  it("returns an empty string for no values", () => {
    expect(renderSparkline([])).toBe("");
  });
});
