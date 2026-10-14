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
