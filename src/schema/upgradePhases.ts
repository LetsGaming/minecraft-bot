/**
 * The steps of an upgrade or prune job as the Discord message and the dashboard
 * show them, from the job's event list. One copy for both, like format.ts.
 *
 * Plain data only, per the package rule.
 */

export type PhaseStatus = "running" | "done" | "error";

export interface PhaseRow {
  phase: string;
  status: PhaseStatus;
  msg: string;
}

/**
 * The latest status of each top-level phase, in the order they first appeared.
 *
 * A sub-step (apply.jar) is progress inside its phase, never its completion. A
 * phase the job left while it was still running counts as done: the setup suite
 * reports a failure before it moves on, and it does not report every step that
 * succeeds (the countdown and the stop only say they started).
 */
export function phaseRows(events: readonly { phase: string; status: string; msg: string }[]): PhaseRow[] {
  const order: string[] = [];
  const latest = new Map<string, PhaseRow>();
  let current: string | null = null;
  for (const e of events) {
    const base = e.phase.split(".")[0]!;
    if (current !== null && current !== base) {
      const left = latest.get(current)!;
      if (left.status === "running") latest.set(current, { ...left, status: "done" });
    }
    current = base;
    if (!order.includes(base)) order.push(base);
    const raw = e.phase.includes(".") ? "running" : e.status;
    const status: PhaseStatus = raw === "done" ? "done" : raw === "error" ? "error" : "running";
    latest.set(base, { phase: base, status, msg: e.msg });
  }
  return order.map((p) => latest.get(p)!);
}

/** The steps of a clean upgrade, in order; the progress bar counts these. */
export const UPGRADE_PHASES = ["plan", "countdown", "stop", "backup", "apply", "start"] as const;

/** The same for a prune-only job, which has no install. */
export const PRUNE_PHASES = ["plan", "countdown", "stop", "backup", "prune", "start"] as const;

/** Every top-level phase a job can report, including the ones off the happy path. */
export const JOB_PHASES = [
  "plan",
  "countdown",
  "stop",
  "backup",
  "apply",
  "prune",
  "start",
  "mods",
  "rollback",
  "abort",
] as const;

/** Why a job failed, as the wrapper reports it. */
export const JOB_FAILURE_REASONS = [
  "plan_failed",
  "mods_changed",
  "stop_failed",
  "backup_failed",
  "apply_failed",
  "prune_failed",
  "prune_stale",
  "prune_timeout",
  "crash_loop",
  "timeout",
  "start_failed",
  "rollback_failed",
] as const;

export type UpgradePhase = (typeof UPGRADE_PHASES)[number];
export type PrunePhase = (typeof PRUNE_PHASES)[number];
export type JobPhase = (typeof JOB_PHASES)[number];
export type JobFailureReason = (typeof JOB_FAILURE_REASONS)[number];

export function isUpgradePhase(value: unknown): value is UpgradePhase {
  return (UPGRADE_PHASES as readonly unknown[]).includes(value);
}

export function isPrunePhase(value: unknown): value is PrunePhase {
  return (PRUNE_PHASES as readonly unknown[]).includes(value);
}

export function isJobPhase(value: unknown): value is JobPhase {
  return (JOB_PHASES as readonly unknown[]).includes(value);
}

export function isJobFailureReason(value: unknown): value is JobFailureReason {
  return (JOB_FAILURE_REASONS as readonly unknown[]).includes(value);
}
