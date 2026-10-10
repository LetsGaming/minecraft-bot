/**
 * Characterization tests for the host resources monitor (disk and backup
 * age alerts with hysteresis) and the update notifier (release check and
 * once-per-version admin DMs).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const cfg = vi.hoisted(() => ({
  value: {} as Record<string, unknown>,
  throwOnLoad: false,
}));
vi.mock("../../src/core/config.js", () => ({
  loadConfig: () => {
    if (cfg.throwOnLoad) throw new Error("config unavailable");
    return cfg.value;
  },
}));

const getHostResources = vi.fn();
vi.mock("../../src/core/utils/server/hostResources.js", () => ({
  getHostResources: (s: unknown) => getHostResources(s) as unknown,
}));

const readBackups = vi.fn();
vi.mock("../../src/core/utils/server/serverAccess.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../src/core/utils/server/serverAccess.js")
  >()),
  readBackups: (...a: unknown[]) => readBackups(...a) as unknown,
}));

const serverInScope = vi.fn();
vi.mock("../../src/bot/utils/guild/guildRouter.js", () => ({
  serverInScope: (...a: unknown[]) => serverInScope(...a) as unknown,
}));

const fetchJson = vi.fn();
vi.mock("../../src/core/utils/http.js", () => ({
  fetchJson: (...a: unknown[]) => fetchJson(...a) as unknown,
  describeFailure: () => "failure",
}));

import {
  startHostResourcesMonitor,
  _resetStateForTesting,
} from "../../src/bot/logWatcher/watchers/monitors/hostResourcesMonitor.js";
import {
  startUpdateNotifier,
  fetchLatestVersion,
  currentVersion,
} from "../../src/bot/logWatcher/watchers/monitors/updateNotifier.js";
import { kvGet, kvSet } from "../../src/core/db/kv.js";
import { closeDbForTesting } from "../../src/core/db/index.js";
import type { Client } from "discord.js";

const TICK = 5 * 60 * 1000;

const send = vi.fn();
function makeClient(channel: unknown = { send }) {
  return {
    channels: { fetch: vi.fn().mockResolvedValue(channel) },
    users: { fetch: vi.fn() },
  };
}

function disk(percent: number, mount = "/", path = "/srv/world") {
  return {
    path,
    sizeBytes: null,
    filesystem: { mountPoint: mount, usedPercent: percent, availableBytes: 1024 },
  };
}
const guilds = {
  g1: { downtimeAlerts: { channelId: "alerts", mentionRole: "role-1" } },
};
const server = (id = "smp", capabilities: unknown = null) =>
  ({ id, config: { id }, capabilities }) as never;

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  closeDbForTesting();
  _resetStateForTesting();
  cfg.value = {};
  cfg.throwOnLoad = false;
  send.mockReset().mockResolvedValue(undefined);
  getHostResources.mockReset().mockResolvedValue({ disks: [disk(50)] });
  readBackups.mockReset().mockResolvedValue({ dirs: [] });
  serverInScope.mockReset().mockReturnValue(true);
  fetchJson.mockReset();
});
afterEach(() => vi.useRealTimers());

function start(
  client = makeClient(),
  servers = [server()],
  guildConfigs: unknown = guilds,
) {
  const timer = startHostResourcesMonitor(
    servers,
    client as unknown as Client,
    guildConfigs as never,
  );
  return { timer: timer!, client };
}

describe("hostResourcesMonitor disk alerts", () => {
  it("warns once when usage crosses the default 90% and pings the role", async () => {
    getHostResources.mockResolvedValue({ disks: [disk(93)] });
    const { timer } = start();
    await vi.advanceTimersByTimeAsync(TICK);
    expect(send).toHaveBeenCalledTimes(1);
    const payload = send.mock.calls[0]![0] as { content: string; embeds: unknown[] };
    expect(payload.content).toBe("<@&role-1>");

    await vi.advanceTimersByTimeAsync(TICK * 2);
    expect(send).toHaveBeenCalledTimes(1);
    clearInterval(timer);
  });

  it("re-arms only after usage drops 5 points below the threshold, with an all-clear", async () => {
    cfg.value = { hostAlerts: { diskWarnPercent: 80 } };
    getHostResources.mockResolvedValue({ disks: [disk(85)] });
    const { timer } = start();
    await vi.advanceTimersByTimeAsync(TICK);
    expect(send).toHaveBeenCalledTimes(1);

    getHostResources.mockResolvedValue({ disks: [disk(77)] });
    await vi.advanceTimersByTimeAsync(TICK);
    expect(send).toHaveBeenCalledTimes(1);

    getHostResources.mockResolvedValue({ disks: [disk(75)] });
    await vi.advanceTimersByTimeAsync(TICK);
    expect(send).toHaveBeenCalledTimes(2);

    getHostResources.mockResolvedValue({ disks: [disk(90)] });
    await vi.advanceTimersByTimeAsync(TICK);
    expect(send).toHaveBeenCalledTimes(3);
    clearInterval(timer);
  });

  it("alerts once per filesystem when two monitored paths share a mount", async () => {
    getHostResources.mockResolvedValue({
      disks: [disk(95, "/", "/srv/world"), disk(95, "/", "/srv/backups")],
    });
    const { timer } = start();
    await vi.advanceTimersByTimeAsync(TICK);
    expect(send).toHaveBeenCalledTimes(1);
    clearInterval(timer);
  });

  it("alerts per path when the wrapper reports no mount point", async () => {
    getHostResources.mockResolvedValue({
      disks: [disk(95, "", "/srv/world"), disk(95, "", "/srv/backups")],
    });
    const { timer } = start();
    await vi.advanceTimersByTimeAsync(TICK);
    expect(send).toHaveBeenCalledTimes(2);
    clearInterval(timer);
  });

  it("does nothing when disk alerts and backup alerts are both off", async () => {
    cfg.value = { hostAlerts: { diskWarnPercent: 0 } };
    getHostResources.mockResolvedValue({ disks: [disk(99)] });
    const { timer } = start();
    await vi.advanceTimersByTimeAsync(TICK);
    expect(getHostResources).not.toHaveBeenCalled();
    clearInterval(timer);
  });

  it("falls back to the default threshold when the config cannot be read", async () => {
    cfg.throwOnLoad = true;
    getHostResources.mockResolvedValue({ disks: [disk(95)] });
    const { timer } = start();
    await vi.advanceTimersByTimeAsync(TICK);
    expect(send).toHaveBeenCalledTimes(1);
    clearInterval(timer);
  });

  it("skips guilds whose alert channel is scoped to another server", async () => {
    serverInScope.mockReturnValue(false);
    getHostResources.mockResolvedValue({ disks: [disk(95)] });
    const { timer } = start();
    await vi.advanceTimersByTimeAsync(TICK);
    expect(send).not.toHaveBeenCalled();
    clearInterval(timer);
  });

  it("ignores guilds without a downtime alert channel and channels that cannot send", async () => {
    getHostResources.mockResolvedValue({ disks: [disk(95)] });
    const noChannel = start(makeClient(), [server()], { g1: {} });
    await vi.advanceTimersByTimeAsync(TICK);
    expect(noChannel.client.channels.fetch).not.toHaveBeenCalled();
    clearInterval(noChannel.timer);

    _resetStateForTesting();
    const mute = start(makeClient({}), [server()], guilds);
    await vi.advanceTimersByTimeAsync(TICK);
    expect(send).not.toHaveBeenCalled();
    clearInterval(mute.timer);
  });

  it("keeps checking other servers when one fails, and treats a missing host block as no disks", async () => {
    getHostResources
      .mockRejectedValueOnce(new Error("wrapper down"))
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ disks: [disk(95)] });
    const { timer } = start(makeClient(), [server("a"), server("b"), server("c")]);
    await vi.advanceTimersByTimeAsync(TICK);
    expect(getHostResources).toHaveBeenCalledTimes(3);
    expect(send).toHaveBeenCalledTimes(1);
    clearInterval(timer);
  });

  it("reads the guild list per tick so a reload can add an alert target", async () => {
    getHostResources.mockResolvedValue({ disks: [disk(95)] });
    let current: Record<string, unknown> = {};
    const timer = startHostResourcesMonitor(
      [server()],
      makeClient() as unknown as Client,
      (() => current) as never,
    )!;
    await vi.advanceTimersByTimeAsync(TICK);
    expect(send).not.toHaveBeenCalled();

    _resetStateForTesting();
    current = guilds;
    await vi.advanceTimersByTimeAsync(TICK);
    expect(send).toHaveBeenCalledTimes(1);
    clearInterval(timer);
  });
});

describe("hostResourcesMonitor backup age", () => {
  const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);

  beforeEach(() => {
    cfg.value = { hostAlerts: { diskWarnPercent: 0, backupMaxAgeHours: 24 } };
  });

  it("alerts once when the newest backup is older than the limit and clears when a fresh one appears", async () => {
    readBackups.mockResolvedValue({
      dirs: [{ latestMtime: hoursAgo(30) }, { latestMtime: hoursAgo(50) }],
    });
    const { timer } = start();
    await vi.advanceTimersByTimeAsync(TICK);
    expect(send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(TICK);
    expect(send).toHaveBeenCalledTimes(1);

    readBackups.mockResolvedValue({ dirs: [{ latestMtime: hoursAgo(0.2) }] });
    await vi.advanceTimersByTimeAsync(TICK);
    expect(send).toHaveBeenCalledTimes(2);
    clearInterval(timer);
  });

  it("uses the newest of several backup directories", async () => {
    readBackups.mockResolvedValue({
      dirs: [{ latestMtime: hoursAgo(100) }, { latestMtime: hoursAgo(1) }],
    });
    const { timer } = start();
    await vi.advanceTimersByTimeAsync(TICK);
    expect(send).not.toHaveBeenCalled();
    clearInterval(timer);
  });

  it("skips servers without the backup layout, with no backups, or with an unreadable directory", async () => {
    readBackups.mockResolvedValue({ dirs: [{ latestMtime: hoursAgo(99) }] });
    const noBackups = start(makeClient(), [server("smp", { backups: false })]);
    await vi.advanceTimersByTimeAsync(TICK);
    expect(readBackups).not.toHaveBeenCalled();
    clearInterval(noBackups.timer);

    readBackups.mockResolvedValue({ dirs: [] });
    const empty = start();
    await vi.advanceTimersByTimeAsync(TICK);
    clearInterval(empty.timer);

    readBackups.mockRejectedValue(new Error("EACCES"));
    const unreadable = start();
    await vi.advanceTimersByTimeAsync(TICK);
    clearInterval(unreadable.timer);
    expect(send).not.toHaveBeenCalled();
  });

  it("treats an unprobed capability set as capable", async () => {
    readBackups.mockResolvedValue({ dirs: [{ latestMtime: hoursAgo(99) }] });
    const { timer } = start(makeClient(), [server("smp", null)]);
    await vi.advanceTimersByTimeAsync(TICK);
    expect(send).toHaveBeenCalledTimes(1);
    clearInterval(timer);
  });
});

describe("updateNotifier", () => {
  const INITIAL = 60_000;
  const admin = "123456789012345678";

  function release(tag: string) {
    fetchJson.mockResolvedValue({ ok: true, value: { tag_name: tag } });
  }
  async function tick(client = makeClient()) {
    const timer = startUpdateNotifier(client as unknown as Client);
    await vi.advanceTimersByTimeAsync(INITIAL);
    clearInterval(timer);
    return client;
  }

  it("fetchLatestVersion strips the v prefix and tolerates bad payloads", async () => {
    release(" V9.9.9 ");
    expect(await fetchLatestVersion()).toBe("9.9.9");
    fetchJson.mockResolvedValue({ ok: true, value: { tag_name: "" } });
    expect(await fetchLatestVersion()).toBeNull();
    fetchJson.mockResolvedValue({ ok: true, value: "nope" });
    expect(await fetchLatestVersion()).toBeNull();
    fetchJson.mockResolvedValue({ ok: false, failure: { kind: "network" } });
    expect(await fetchLatestVersion()).toBeNull();
  });

  it("reads the running version from package.json", () => {
    expect(currentVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("does not check at all while disabled", async () => {
    cfg.value = { updateNotifier: { enabled: false, dmAdmins: true } };
    await tick();
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it("checks but never DMs unless dmAdmins is true", async () => {
    release("999.0.0");
    cfg.value = { adminUsers: [admin] };
    const client = await tick();
    expect(fetchJson).toHaveBeenCalledTimes(1);
    expect(client.users.fetch).not.toHaveBeenCalled();
  });

  it("DMs snowflake admins once per discovered version and remembers it", async () => {
    release("999.0.0");
    cfg.value = {
      updateNotifier: { dmAdmins: true },
      adminUsers: [admin, "role:mods", "not-a-snowflake"],
    };
    const dm = vi.fn().mockResolvedValue(undefined);
    const client = makeClient();
    client.users.fetch.mockResolvedValue({ send: dm });
    await tick(client);
    expect(client.users.fetch).toHaveBeenCalledTimes(1);
    expect(client.users.fetch).toHaveBeenCalledWith(admin);
    expect(String(dm.mock.calls[0]![0])).toContain("999.0.0");
    expect(kvGet("updateNotifier")).toEqual({ lastNotifiedVersion: "999.0.0" });

    await tick(client);
    expect(dm).toHaveBeenCalledTimes(1);

    release("999.1.0");
    await tick(client);
    expect(dm).toHaveBeenCalledTimes(2);
  });

  it("stays quiet when up to date or when the check fails", async () => {
    cfg.value = { updateNotifier: { dmAdmins: true }, adminUsers: [admin] };
    release("0.0.1");
    const upToDate = await tick();
    expect(upToDate.users.fetch).not.toHaveBeenCalled();

    fetchJson.mockResolvedValue({ ok: false, failure: { kind: "network" } });
    const failed = await tick();
    expect(failed.users.fetch).not.toHaveBeenCalled();
    expect(kvGet("updateNotifier")).toBeNull();
  });

  it("marks the version notified even when every DM fails", async () => {
    release("999.0.0");
    cfg.value = { updateNotifier: { dmAdmins: true }, adminUsers: [admin] };
    const client = makeClient();
    client.users.fetch.mockRejectedValue(new Error("Unknown User"));
    await tick(client);
    expect(kvGet("updateNotifier")).toEqual({ lastNotifiedVersion: "999.0.0" });
  });

  it("does not re-notify a version that was already recorded", async () => {
    kvSet("updateNotifier", { lastNotifiedVersion: "999.0.0" });
    release("999.0.0");
    cfg.value = { updateNotifier: { dmAdmins: true }, adminUsers: [admin] };
    const client = await tick();
    expect(client.users.fetch).not.toHaveBeenCalled();
  });
});
