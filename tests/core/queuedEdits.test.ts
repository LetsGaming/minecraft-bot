import { describe, it, expect } from "vitest";
import {
  planMerge,
  type QueuedEdit,
} from "../../src/core/utils/stores/queuedEdits.js";

function edit(
  keyPath: string[],
  newValue: unknown,
  baseValue: unknown,
): QueuedEdit {
  return {
    id: 1,
    serverId: "smp",
    fileId: "abc",
    relPath: "config/antixray.toml",
    keyPath,
    newValue,
    baseValue,
    queuedAt: 0,
    byId: null,
    byTag: "dom",
  };
}

const atDisk = (entries: [string[], unknown][]): Map<string, unknown> =>
  new Map(entries.map(([path, value]) => [JSON.stringify(path), value]));

describe("planMerge", () => {
  it("applies an edit whose key is untouched since queueing", () => {
    const plan = planMerge(
      [edit(["overworld", "engineMode"], 3, 2)],
      atDisk([[["overworld", "engineMode"], 2]]),
    );
    expect(plan.apply).toHaveLength(1);
    expect(plan.conflicts).toHaveLength(0);
  });

  it("conflicts only when THAT key moved underneath the edit", () => {
    const plan = planMerge(
      [edit(["overworld", "engineMode"], 3, 2)],
      atDisk([[["overworld", "engineMode"], 5]]),
    );
    expect(plan.apply).toHaveLength(0);
    expect(plan.conflicts).toHaveLength(1);
    // All three values, so a person can decide in one read.
    expect(plan.conflicts[0]).toMatchObject({ queued: 3, base: 2, current: 5 });
  });

  it("does not conflict an edit because a DIFFERENT key changed", () => {
    // This is the whole point of the per-field policy: a whole-file merge
    // would have thrown this edit away over an unrelated change.
    const plan = planMerge(
      [edit(["overworld", "engineMode"], 3, 2)],
      atDisk([
        [["overworld", "engineMode"], 2],
        [["overworld", "maxBlockHeight"], 320],
      ]),
    );
    expect(plan.apply).toHaveLength(1);
    expect(plan.conflicts).toHaveLength(0);
  });

  it("treats a key the disk already satisfies as done, not as a write", () => {
    // Someone else made the same change. Writing it again would churn the
    // file's mtime and burn a snapshot for no diff.
    const plan = planMerge(
      [edit(["overworld", "engineMode"], 3, 2)],
      atDisk([[["overworld", "engineMode"], 3]]),
    );
    expect(plan.alreadyApplied).toHaveLength(1);
    expect(plan.apply).toHaveLength(0);
    expect(plan.conflicts).toHaveLength(0);
  });

  it("conflicts rather than silently re-adding a key that vanished", () => {
    // A mod update dropped the key. Resurrecting it without asking is not
    // this function's call to make.
    const plan = planMerge([edit(["gone"], 1, 0)], atDisk([]));
    expect(plan.conflicts).toHaveLength(1);
    expect(plan.conflicts[0]?.current).toBeNull();
  });

  it("compares against the base, not against the queued value", () => {
    // An edit back to a value's original is still an edit: base 5 → new 2,
    // disk still 5, so it applies.
    const plan = planMerge(
      [edit(["k"], 2, 5)],
      atDisk([[["k"], 5]]),
    );
    expect(plan.apply).toHaveLength(1);
  });

  it("compares lists structurally and order-sensitively", () => {
    const same = planMerge(
      [edit(["blocks"], ["a", "b"], ["x"])],
      atDisk([[["blocks"], ["x"]]]),
    );
    expect(same.apply).toHaveLength(1);

    // Order is meaningful in config lists (load order, replacement blocks),
    // so a reorder on disk is a real change and must conflict.
    const reordered = planMerge(
      [edit(["blocks"], ["a", "b"], ["x", "y"])],
      atDisk([[["blocks"], ["y", "x"]]]),
    );
    expect(reordered.conflicts).toHaveLength(1);
  });

  it("sorts a mixed batch into all three buckets independently", () => {
    const plan = planMerge(
      [
        edit(["clean"], 1, 0),
        edit(["contended"], 1, 0),
        edit(["done"], 1, 0),
      ],
      atDisk([
        [["clean"], 0],
        [["contended"], 99],
        [["done"], 1],
      ]),
    );
    expect(plan.apply.map((e) => e.keyPath[0])).toEqual(["clean"]);
    expect(plan.conflicts.map((c) => c.keyPath[0])).toEqual(["contended"]);
    expect(plan.alreadyApplied.map((e) => e.keyPath[0])).toEqual(["done"]);
  });

  it("handles an empty queue", () => {
    const plan = planMerge([], atDisk([]));
    expect(plan).toEqual({ apply: [], conflicts: [], alreadyApplied: [] });
  });
});

describe("auto-flush edge detection", () => {
  it("fires only on the transition back to reachable", async () => {
    const { noteWrapperState, resetAutoFlushState } = await import(
      "../../src/core/utils/wrapper/queueFlush.js"
    );
    resetAutoFlushState();

    // A wrapper that has simply always been up is not an edge. Without this,
    // a healthy server would retry conflicted edits on every status poll,
    // writing to a live config file several times a minute.
    expect(noteWrapperState("smp", true)).toBe(false);
    expect(noteWrapperState("smp", true)).toBe(false);

    // Down, then up, is an edge — but with no queued work there is still
    // nothing to do, so it stays false.
    noteWrapperState("smp", false);
    expect(noteWrapperState("smp", true)).toBe(false);

    // And the edge is consumed: a second poll after recovery is not another
    // transition.
    expect(noteWrapperState("smp", true)).toBe(false);
  });

  it("tracks servers independently", async () => {
    const { noteWrapperState, resetAutoFlushState } = await import(
      "../../src/core/utils/wrapper/queueFlush.js"
    );
    resetAutoFlushState();
    noteWrapperState("smp", false);
    // creative was never down, so its recovery is not an edge.
    expect(noteWrapperState("creative", true)).toBe(false);
  });
});
