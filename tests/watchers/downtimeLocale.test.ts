/**
 * Downtime alert text is built per guild, in that guild's language, not once
 * in the global language.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../src/core/config.js", () => ({
  loadConfig: () => ({
    language: "en",
    guilds: { g1: { language: "en" }, g2: { language: "de" } },
  }),
}));

vi.mock("../../src/bot/utils/guild/guildRouter.js", () => ({
  serverInScope: vi.fn().mockReturnValue(true),
  getAllowedServerIds: vi.fn().mockReturnValue(null),
}));

vi.mock("../../src/core/utils/stores/uptimeTracker.js", () => ({
  recordCheck: vi.fn().mockResolvedValue(undefined),
}));

const createEmbed = vi.hoisted(() => vi.fn());
vi.mock("../../src/bot/utils/embeds/embedUtils.js", () => ({ createEmbed }));

import { startDowntimeMonitor } from "../../src/bot/logWatcher/watchers/monitors/downtimeMonitor.js";
import { en } from "../../src/core/locales/en.js";
import { de } from "../../src/core/locales/de.js";

const TICK = 60_001;

beforeEach(() => {
  vi.useFakeTimers();
  createEmbed.mockReset().mockImplementation((opts: unknown) => opts);
});
afterEach(() => vi.useRealTimers());

describe("downtime alert language", () => {
  it("renders each guild's alert in its own language", async () => {
    const server = {
      id: "locale-srv",
      getHealth: vi.fn().mockResolvedValue({
        state: "offline",
        source: "wrapper",
        wrapper: "up",
        processUp: false,
        rcon: "unknown",
        probe: "none",
        players: null,
        reason: null,
        checkedAt: Date.now(),
        restartCount: 0,
        unitFailed: false,
      }),
    } as never;
    const send = vi.fn().mockResolvedValue(undefined);
    const client = {
      channels: { fetch: vi.fn().mockResolvedValue({ send }) },
    } as never;
    const guilds = {
      g1: { downtimeAlerts: { channelId: "c1" } },
      g2: { downtimeAlerts: { channelId: "c2" } },
    } as never;

    const timer = startDowntimeMonitor([server], client, guilds);
    for (let i = 0; i < 3; i++) await vi.advanceTimersByTimeAsync(TICK);
    clearInterval(timer);

    const titles = createEmbed.mock.calls.map(
      (c) => (c[0] as { title: string }).title,
    );
    expect(titles).toEqual([
      en["downtime.downTitle"]!.replace("{server}", "locale-srv"),
      de["downtime.downTitle"]!.replace("{server}", "locale-srv"),
    ]);
  });
});
