import { describe, it, expect } from "vitest";
import {
  MS,
  TPS_LEVELS,
  DISK_LEVELS,
  DEFAULT_TPS_ALERT_THRESHOLD,
  DEFAULT_DISK_ALERT_PERCENT,
  classifyTps,
  classifyDiskUsage,
  ANALYTICS_CAP_HOURS,
  ANALYTICS_RETENTION_DAYS,
  UPGRADE_PHASES,
  PRUNE_PHASES,
  JOB_PHASES,
  JOB_FAILURE_REASONS,
  isUpgradePhase,
  isPrunePhase,
  isJobPhase,
  isJobFailureReason,
  LANGUAGES,
  isLanguage,
  REGION_CHUNKS,
  REGION_SHIFT,
  REGION_MASK,
  capabilityForServerAction,
  SERVER_OPERATOR_ACTIONS,
} from "@mcbot/schema";
import { RETENTION_HOURS } from "../../src/core/utils/stores/playerCountHistory.js";
import { USAGE_RETENTION_DAYS } from "../../src/core/utils/commands/commandUsage.js";

describe("MS", () => {
  it("is consistent arithmetic", () => {
    expect(MS.minute).toBe(60 * MS.second);
    expect(MS.hour).toBe(60 * MS.minute);
    expect(MS.day).toBe(24 * MS.hour);
    expect(MS.week).toBe(7 * MS.day);
  });
});

describe("health levels", () => {
  it("classifies TPS at the frontend cutoffs", () => {
    expect(classifyTps(20)).toBe("ok");
    expect(classifyTps(TPS_LEVELS.ok)).toBe("ok");
    expect(classifyTps(17.9)).toBe("warn");
    expect(classifyTps(TPS_LEVELS.warn)).toBe("warn");
    expect(classifyTps(11.9)).toBe("critical");
  });

  it("classifies disk fullness at the meter cutoffs", () => {
    expect(classifyDiskUsage(74.9)).toBe("ok");
    expect(classifyDiskUsage(DISK_LEVELS.warn)).toBe("warn");
    expect(classifyDiskUsage(89.9)).toBe("warn");
    expect(classifyDiskUsage(DISK_LEVELS.critical)).toBe("critical");
  });

  it("keeps the alert defaults the monitors shipped with", () => {
    expect(DEFAULT_TPS_ALERT_THRESHOLD).toBe(15);
    expect(DEFAULT_DISK_ALERT_PERCENT).toBe(90);
  });
});

describe("retention", () => {
  it("derives the caps from the retention days", () => {
    for (const key of Object.keys(ANALYTICS_RETENTION_DAYS) as (keyof typeof ANALYTICS_RETENTION_DAYS)[]) {
      expect(ANALYTICS_CAP_HOURS[key]).toBe(ANALYTICS_RETENTION_DAYS[key] * 24);
    }
  });

  it("is what the stores prune with", () => {
    expect(RETENTION_HOURS).toBe(ANALYTICS_CAP_HOURS.activity);
    expect(USAGE_RETENTION_DAYS).toBe(ANALYTICS_RETENTION_DAYS.commands);
    expect(ANALYTICS_CAP_HOURS).toEqual({
      activity: 2160,
      uptime: 720,
      leaderboard: 768,
      commands: 2160,
      sessions: 8760,
    });
  });
});

describe("job phases and reasons", () => {
  it("has guards that accept members and reject everything else", () => {
    expect(isUpgradePhase("apply")).toBe(true);
    expect(isUpgradePhase("prune")).toBe(false);
    expect(isPrunePhase("prune")).toBe(true);
    expect(isPrunePhase("apply")).toBe(false);
    expect(isJobPhase("rollback")).toBe(true);
    expect(isJobPhase("apply.jar")).toBe(false);
    expect(isJobPhase(undefined)).toBe(false);
    expect(isJobFailureReason("crash_loop")).toBe(true);
    expect(isJobFailureReason("nope")).toBe(false);
  });

  it("covers every step of both runs", () => {
    for (const p of [...UPGRADE_PHASES, ...PRUNE_PHASES]) expect(JOB_PHASES).toContain(p);
    expect(JOB_FAILURE_REASONS).toHaveLength(12);
  });
});

describe("languages", () => {
  it("recognises the shipped locales only", () => {
    expect([...LANGUAGES]).toEqual(["en", "de"]);
    expect(isLanguage("de")).toBe(true);
    expect(isLanguage("fr")).toBe(false);
    expect(isLanguage(undefined)).toBe(false);
  });
});

describe("region constants", () => {
  it("agree with each other", () => {
    expect(1 << REGION_SHIFT).toBe(REGION_CHUNKS);
    expect(REGION_MASK).toBe(REGION_CHUNKS - 1);
    expect(-1 >> REGION_SHIFT).toBe(-1);
    expect(33 & REGION_MASK).toBe(1);
  });
});

describe("capabilityForServerAction", () => {
  it("gives rollback its own capability and the rest server:control", () => {
    expect(capabilityForServerAction("rollback")).toBe("server:rollback");
    for (const a of SERVER_OPERATOR_ACTIONS.filter((x) => x !== "rollback")) {
      expect(capabilityForServerAction(a)).toBe("server:control");
    }
  });
});
