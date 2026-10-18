import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const state = vi.hoisted(() => ({
  schedules: {} as Record<string, { restart?: { time: string; warnMinutes?: number[] } }>,
}));

vi.mock("../../src/core/config.js", () => ({
  loadConfig: () => ({
    servers: { s1: {} },
    guilds: {},
    schedules: state.schedules,
  }),
}));
vi.mock("../../src/core/utils/config/timezones.js", () => ({
  scheduleTimeZone: () => "UTC",
}));
vi.mock("../../src/core/utils/server/server.js", () => ({
  getServerInstance: vi.fn(() => ({ config: {}, capabilities: undefined })),
}));
vi.mock("../../src/core/utils/server/serverAccess.js", () => ({
  runScript: vi.fn(),
}));
vi.mock("../../src/core/utils/stores/adminAudit.js", () => ({
  recordAdminAction: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../src/bot/utils/embeds/embedUtils.js", () => ({
  createEmbed: vi.fn((o: { title: string; description: string }) => o),
}));
vi.mock("../../src/bot/logWatcher/watchers/monitors/downtimeMonitor.js", () => ({
  suppressAlerts: vi.fn(),
}));
vi.mock("../../src/bot/logWatcher/watchers/notifyGuilds.js", () => ({
  broadcastNotification: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../src/core/utils/minecraft/serverMessages.js", () => ({
  announce: vi.fn().mockResolvedValue(undefined),
}));

import { runScript } from "../../src/core/utils/server/serverAccess.js";
import { log } from "../../src/core/utils/logger.js";
import { broadcastNotification } from "../../src/bot/logWatcher/watchers/notifyGuilds.js";
import { t } from "../../src/core/utils/i18n.js";
import {
  reconcileRestartSchedules,
  _resetSchedulesForTesting,
} from "../../src/bot/logWatcher/watchers/schedulers/restartScheduler.js";

const CONFIG = {
  servers: { s1: {} },
  schedules: { s1: { restart: { time: "04:00", warnMinutes: [] } } },
} as never;

function broadcastTitles(): string[] {
  return vi.mocked(broadcastNotification).mock.calls.map((c) => {
    const spec = c[2] as { buildEmbed: (f: boolean) => { title: string } };
    return spec.buildEmbed(false).title;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T03:00:00Z"));
  state.schedules = { s1: { restart: { time: "04:00", warnMinutes: [] } } };
  vi.mocked(runScript).mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" } as never);
});
afterEach(() => {
  _resetSchedulesForTesting();
  vi.useRealTimers();
});

describe("restart scheduler run outcome", () => {
  it("announces completion after a successful restart", async () => {
    reconcileRestartSchedules({} as never, CONFIG);
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(broadcastTitles()).toContain(t("schedule.doneTitle", { server: "s1" }));
  });

  it("announces a failure, not completion, when the script exits non-zero", async () => {
    vi.mocked(runScript).mockResolvedValue({ exitCode: 1, stdout: "", stderr: "boom" } as never);
    reconcileRestartSchedules({} as never, CONFIG);
    await vi.advanceTimersByTimeAsync(3_600_000);
    const titles = broadcastTitles();
    expect(titles).not.toContain(t("schedule.doneTitle", { server: "s1" }));
    expect(titles).toContain(t("restart.failedTitle", { server: "s1" }));
  });

  it("announces a failure when the script throws", async () => {
    vi.mocked(runScript).mockRejectedValue(new Error("spawn failed"));
    reconcileRestartSchedules({} as never, CONFIG);
    await vi.advanceTimersByTimeAsync(3_600_000);
    const titles = broadcastTitles();
    expect(titles).not.toContain(t("schedule.doneTitle", { server: "s1" }));
    expect(titles).toContain(t("restart.failedTitle", { server: "s1" }));
  });
});

describe("restart scheduler re-arm", () => {
  it("does not re-arm a schedule removed while the timer was pending", async () => {
    reconcileRestartSchedules({} as never, CONFIG);
    state.schedules = {};
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("re-arms with the current schedule, not the one captured at arm time", async () => {
    reconcileRestartSchedules({} as never, CONFIG);
    state.schedules = { s1: { restart: { time: "06:00", warnMinutes: [] } } };
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(vi.getTimerCount()).toBe(1);
    const messages = vi.mocked(log.info).mock.calls.map((c) => String(c[1]));
    expect(messages.at(-1)).toContain("2026-01-01T06:00:00.000Z");
  });
});
