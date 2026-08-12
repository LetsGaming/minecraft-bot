import { describe, it, expect, beforeEach } from "vitest";
import {
  recordIntent,
  listIntents,
  clearIntent,
  resetIntents,
} from "../../src/core/utils/wrapper/deferredIntents.js";

const NOW = 1_800_000_000_000;
const intent = (serverId: string, action: string, at = NOW) => ({
  serverId,
  action,
  attemptedAt: at,
  byTag: "dom",
  reason: "wrapper unreachable",
});

beforeEach(() => resetIntents());

describe("deferred intents", () => {
  it("remembers an action that could not run", () => {
    recordIntent(intent("smp", "restart"));
    expect(listIntents("smp", NOW)).toHaveLength(1);
  });

  it("treats a repeat attempt as one wish, not two", () => {
    // Pressing Restart twice during an outage is one intent expressed twice.
    recordIntent(intent("smp", "restart", NOW));
    recordIntent(intent("smp", "restart", NOW + 1000));
    const live = listIntents("smp", NOW + 1000);
    expect(live).toHaveLength(1);
    expect(live[0]?.attemptedAt).toBe(NOW + 1000);
  });

  it("keeps different actions apart", () => {
    recordIntent(intent("smp", "restart"));
    recordIntent(intent("smp", "backup"));
    expect(listIntents("smp", NOW)).toHaveLength(2);
  });

  it("keeps servers apart", () => {
    recordIntent(intent("smp", "restart"));
    expect(listIntents("creative", NOW)).toHaveLength(0);
  });

  it("expires an intent nobody is still thinking about", () => {
    // Being asked whether you still want to restart something you tried three
    // hours ago is noise, and saying yes by reflex is the accident this whole
    // design exists to avoid.
    recordIntent(intent("smp", "restart", NOW));
    expect(listIntents("smp", NOW + 31 * 60_000)).toHaveLength(0);
  });

  it("keeps one inside the window", () => {
    recordIntent(intent("smp", "restart", NOW));
    expect(listIntents("smp", NOW + 29 * 60_000)).toHaveLength(1);
  });

  it("clears one that was granted or dismissed", () => {
    recordIntent(intent("smp", "restart"));
    clearIntent("smp", "restart");
    expect(listIntents("smp", NOW)).toHaveLength(0);
  });

  it("returns newest first", () => {
    recordIntent(intent("smp", "backup", NOW - 5000));
    recordIntent(intent("smp", "restart", NOW));
    expect(listIntents("smp", NOW).map((i) => i.action)).toEqual(["restart", "backup"]);
  });
});
