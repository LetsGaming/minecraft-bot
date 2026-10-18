import { describe, it, expect } from "vitest";
import { nextTimeOfDayEpoch } from "../../src/core/utils/time.js";

const localHm = (epoch: number, tz: string): string =>
  new Date(epoch).toLocaleString("sv-SE", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

describe("nextTimeOfDayEpoch around DST transitions", () => {
  it("lands on 04:00 local on the spring-forward day", () => {
    const from = Date.UTC(2026, 2, 8, 0, 0); // 2026-03-07 17:00 in Denver
    const epoch = nextTimeOfDayEpoch(4, 0, "America/Denver", from);
    expect(localHm(epoch, "America/Denver")).toBe("04:00");
    expect(epoch).toBe(Date.UTC(2026, 2, 8, 10, 0));
  });

  it("lands on 04:00 local on the fall-back day", () => {
    const from = Date.UTC(2026, 10, 1, 0, 0); // 2026-10-31 18:00 in Denver
    const epoch = nextTimeOfDayEpoch(4, 0, "America/Denver", from);
    expect(localHm(epoch, "America/Denver")).toBe("04:00");
    expect(epoch).toBe(Date.UTC(2026, 10, 1, 11, 0));
  });

  it("is unchanged on an ordinary day and in UTC", () => {
    const from = Date.UTC(2026, 5, 10, 0, 0);
    expect(nextTimeOfDayEpoch(4, 0, "America/Denver", from)).toBe(Date.UTC(2026, 5, 10, 10, 0));
    expect(nextTimeOfDayEpoch(4, 0, "UTC", from)).toBe(Date.UTC(2026, 5, 10, 4, 0));
  });
});
