/**
 * The live Discord message for a server upgrade: what it says at each stage,
 * that it is edited rather than reposted, that downtime alerts stay quiet while
 * the job runs, and that old history is not announced.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  createUpgradeMonitor,
  phaseViews,
  renderUpgrade,
  type UpgradeMonitorDeps,
} from "../../src/bot/logWatcher/watchers/monitors/upgradeMonitor.js";
import { holdAlerts } from "../../src/bot/logWatcher/watchers/monitors/downtimeMonitor.js";
import type { UpgradeJob } from "../../src/schema/wire/index.js";

const NOW = 1_800_000_000_000;
const ev = (seq: number, phase: string, status: string, msg = "", ts = NOW / 1000 - 5) => ({
  seq,
  ts,
  phase,
  status,
  msg,
});

function job(partial: Partial<UpgradeJob> = {}): UpgradeJob {
  return {
    jobId: "6f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f",
    state: "running",
    mcVersion: "1.21.5",
    events: [ev(1, "plan", "done"), ev(2, "stop", "running", "Saving")],
    next: 2,
    ...partial,
  } as UpgradeJob;
}

const text = (embed: { toJSON(): { title?: string; description?: string } }) => {
  const j = embed.toJSON();
  return `${j.title}\n${j.description}`;
};

describe("phaseViews", () => {
  it("keeps the latest status per phase in order and treats sub-steps as running", () => {
    const views = phaseViews([
      ev(1, "plan", "running"),
      ev(2, "plan", "done"),
      ev(3, "apply", "running"),
      ev(4, "apply.jar", "running", "Installing"),
    ]);
    expect(views.map((v) => [v.phase, v.status])).toEqual([
      ["plan", "done"],
      ["apply", "running"],
    ]);
    expect(views[1]!.msg).toBe("Installing");
  });

  it("does not let a finished sub-step mark its phase done", () => {
    const views = phaseViews([ev(1, "apply", "running"), ev(2, "apply.mods", "done")]);
    expect(views[0]!.status).toBe("running");
  });
});

describe("renderUpgrade", () => {
  it("shows progress while running", () => {
    const out = text(renderUpgrade("smp", job()));
    expect(out).toContain("smp");
    expect(out).toContain("1.21.5");
    expect(out).toContain("✅");
    expect(out).toContain("⏳");
    expect(out).toContain("1/6");
  });

  it("reports a clean success", () => {
    const out = text(
      renderUpgrade(
        "smp",
        job({
          state: "done",
          result: { ok: true, branch: "clean", target: "1.21.5", archive: "a.tar.zst", disabled: [], keptOnOldBuild: [] },
        }),
      ),
    );
    expect(out).toContain("is now on 1.21.5");
    expect(out).toContain("every mod as it was");
    expect(out).toContain("a.tar.zst");
  });

  it("names disabled mods and mods kept on an old build", () => {
    const out = text(
      renderUpgrade(
        "smp",
        job({
          state: "done",
          result: { ok: true, branch: "mods_disabled", disabled: ["sodium"], keptOnOldBuild: ["lithium"] },
        }),
      ),
    );
    expect(out).toContain("sodium");
    expect(out).toContain("lithium");
    expect(out).toContain("misbehave");
  });

  it("says plainly when it rolled back, and when the restore itself failed", () => {
    const rolled = text(renderUpgrade("smp", job({ state: "failed", result: { ok: false, rolledBack: true, previousVersionRunning: true } })));
    expect(rolled).toContain("rolled back");
    expect(rolled).toContain("previous version is running");
    const broken = text(renderUpgrade("smp", job({ state: "failed", result: { ok: false, rolledBack: false, reason: "rollback_failed" } })));
    expect(broken).toContain("restore failed");
    expect(broken).toContain("by hand");
  });

  it("explains a failure that changed nothing, and a job that vanished", () => {
    const early = text(renderUpgrade("smp", job({ state: "failed", result: { ok: false, rolledBack: false, reason: "backup_failed" } })));
    expect(early).toContain("Nothing was changed");
    expect(early).toContain("the backup failed");
    const gone = text(renderUpgrade("smp", job({ state: "failed", error: "interrupted" })));
    expect(gone).toContain("without a result");
  });

  it("never prints an unknown reason code", () => {
    const out = text(renderUpgrade("smp", job({ state: "failed", result: { ok: false, rolledBack: false, reason: "/secret/path" } })));
    expect(out).not.toContain("/secret/path");
  });
});

describe("the monitor", () => {
  const send = vi.fn();
  const edit = vi.fn();
  let current: UpgradeJob | null;
  let now: number;
  const hold = vi.fn();

  const client = {
    channels: {
      fetch: vi.fn(async () => ({ send })),
    },
  } as never;
  const guilds = { g1: { downtimeAlerts: { channelId: "c1", server: "smp" } } } as never;
  const server = { id: "smp", config: { id: "smp", apiUrl: "http://w" } } as never;

  function monitor(over: Partial<UpgradeMonitorDeps> = {}) {
    return createUpgradeMonitor(client, guilds, {
      getCurrentUpgrade: vi.fn(async () => current),
      supportsUpgrade: vi.fn(async () => true),
      holdAlerts: hold as unknown as typeof holdAlerts,
      now: () => now,
      ...over,
    } as UpgradeMonitorDeps);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    now = NOW;
    send.mockResolvedValue({ edit });
    edit.mockResolvedValue(undefined);
    current = null;
  });

  it("posts once for a running job, edits on change, and holds downtime alerts", async () => {
    const m = monitor();
    current = job();
    await m.tick([server]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(hold).toHaveBeenCalledWith("smp", expect.any(Number));

    await m.tick([server]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(edit).not.toHaveBeenCalled();

    current = job({ events: [...job().events, ev(3, "stop", "done")], next: 3 });
    await m.tick([server]);
    expect(edit).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("edits the same message into the result", async () => {
    const m = monitor();
    current = job();
    await m.tick([server]);
    current = job({ state: "done", result: { ok: true, branch: "clean" }, events: [...job().events, ev(3, "start", "done")] });
    await m.tick([server]);
    expect(edit).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(edit.mock.calls[0])).toContain("is now on");
  });

  it("does not announce a job that finished long ago", async () => {
    const m = monitor();
    current = job({
      state: "done",
      result: { ok: true },
      events: [ev(1, "start", "done", "", NOW / 1000 - 3 * 3600)],
    });
    await m.tick([server]);
    expect(send).not.toHaveBeenCalled();
  });

  it("announces a result that arrived while the bot was restarting", async () => {
    const m = monitor();
    current = job({ state: "done", result: { ok: true } });
    await m.tick([server]);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("does nothing for a server whose wrapper cannot upgrade or has no job", async () => {
    const getCurrentUpgrade = vi.fn(async () => current);
    const unsupported = monitor({ supportsUpgrade: vi.fn(async () => false), getCurrentUpgrade });
    current = job();
    await unsupported.tick([server]);
    expect(getCurrentUpgrade).not.toHaveBeenCalled();

    const idle = monitor();
    current = null;
    await idle.tick([server]);
    expect(send).not.toHaveBeenCalled();
    expect(hold).not.toHaveBeenCalled();
  });

  it("survives an unreachable wrapper", async () => {
    const m = monitor({ getCurrentUpgrade: vi.fn(async () => { throw new Error("down"); }) });
    await expect(m.tick([server])).resolves.toBeUndefined();
    expect(send).not.toHaveBeenCalled();
  });

  it("skips a guild whose alert channel is scoped to another server", async () => {
    const scoped = createUpgradeMonitor(
      client,
      { g1: { downtimeAlerts: { channelId: "c1", server: "other" } } } as never,
      {
        getCurrentUpgrade: vi.fn(async () => job()),
        supportsUpgrade: vi.fn(async () => true),
        holdAlerts: hold as unknown as typeof holdAlerts,
        now: () => now,
      },
    );
    await scoped.tick([server]);
    expect(send).not.toHaveBeenCalled();
  });
});

describe("a prune job", () => {
  it("is titled and counted as a prune, and reports what it deleted", () => {
    const running = text(
      renderUpgrade("smp", job({ kind: "prune", mcVersion: "", events: [ev(1, "plan", "done"), ev(2, "prune", "running", "Deleting")] })),
    );
    expect(running).toContain("Pruning unused chunks on smp");
    expect(running).toContain("1/6");

    const done = text(
      renderUpgrade(
        "smp",
        job({
          kind: "prune",
          mcVersion: "",
          state: "done",
          result: { ok: true, branch: "clean", prunedChunks: 4200, bytesFreed: 3 * 1024 * 1024 },
        }),
      ),
    );
    expect(done).toContain("Unused chunks pruned on smp");
    expect(done).toContain("4200 unused chunks deleted");
    expect(done).toContain("3 MB");
  });

  it("explains a plan that went stale", () => {
    const out = text(
      renderUpgrade("smp", job({ kind: "prune", state: "failed", result: { ok: false, rolledBack: true, reason: "prune_stale" } })),
    );
    expect(out).toContain("rolled back");
  });

  it("reports chunks pruned inside an upgrade too", () => {
    const out = text(
      renderUpgrade("smp", job({ state: "done", result: { ok: true, branch: "clean", prunedChunks: 10, bytesFreed: 2048 } })),
    );
    expect(out).toContain("10 unused chunks deleted");
    expect(out).toContain("is now on 1.21.5");
  });
});
