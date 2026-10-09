import { describe, it, expect } from "vitest";
import { formatLastSeen } from "../../src/bot/utils/discordTime.js";

describe("formatLastSeen", () => {
  it("renders a relative Discord timestamp in whole seconds", () => {
    expect(formatLastSeen(1_700_000_123_999)).toBe("<t:1700000123:R>");
  });
});
