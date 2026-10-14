/**
 * An open console stream re-checks its viewer on a timer, so access that goes
 * stale without any reload event (a cookie expiring, an admin removed from the
 * config by a process that never notified this one) still ends the stream.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

process.env.WEBUI_SESSION_SECRET = "unit-test-session-secret";
process.env.WEBUI_CLIENT_SECRET = "unit-test-client-secret";

const ADMIN = "111111111111111111";
const GRANTED = "222222222222222222";

const state = vi.hoisted(() => ({
  cfg: {
    adminUsers: [] as string[],
    webui: { grants: {} as Record<string, unknown>, sessionEpoch: undefined as number | undefined },
  },
}));

vi.mock("../../src/core/config.js", () => ({
  loadConfig: () => state.cfg,
}));

import {
  registerStream,
  closeRevokedStreams,
  openStreamCount,
  openStreamsForUser,
  streamStillAllowed,
  REVALIDATE_INTERVAL_MS,
  type OpenStream,
} from "../../src/web/backend/console/streamRegistry.js";

function session(uid: string, expIn = 3_600_000) {
  return { uid, tag: uid, guilds: [], exp: Date.now() + expIn };
}

function watch(uid: string, expIn?: number) {
  let stop: () => void = () => {};
  const close = vi.fn(() => stop());
  const stream: OpenStream = { serverId: "smp", session: session(uid, expIn), close };
  stop = registerStream(stream);
  return { close, stop };
}

beforeEach(() => {
  vi.useFakeTimers();
  state.cfg = {
    adminUsers: [ADMIN],
    webui: { grants: { [GRANTED]: { smp: ["server:read"] } }, sessionEpoch: undefined },
  };
});

afterEach(() => {
  closeRevokedStreams(() => false);
  vi.useRealTimers();
});

describe("periodic stream revalidation", () => {
  it("keeps a viewer who is still allowed", () => {
    const { close, stop } = watch(GRANTED);
    vi.advanceTimersByTime(REVALIDATE_INTERVAL_MS * 3);
    expect(close).not.toHaveBeenCalled();
    stop();
  });

  it("closes a sysadmin removed from adminUsers without any reload event", () => {
    const { close } = watch(ADMIN);
    state.cfg.adminUsers = [];
    vi.advanceTimersByTime(REVALIDATE_INTERVAL_MS);
    expect(close).toHaveBeenCalledWith(expect.objectContaining({ reason: "revoked" }));
  });

  it("closes a viewer whose grant disappeared", () => {
    const { close } = watch(GRANTED);
    state.cfg.webui.grants = {};
    vi.advanceTimersByTime(REVALIDATE_INTERVAL_MS);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("closes a stream once its session cookie has expired", () => {
    const { close } = watch(GRANTED, REVALIDATE_INTERVAL_MS / 2);
    vi.advanceTimersByTime(REVALIDATE_INTERVAL_MS);
    expect(close).toHaveBeenCalledTimes(1);
    expect(streamStillAllowed(session(GRANTED, -1), "smp")).toBe(false);
  });

  it("clears its timer and registration when the stream goes away", () => {
    const { stop } = watch(GRANTED);
    expect(openStreamCount()).toBe(1);
    expect(vi.getTimerCount()).toBe(1);
    stop();
    expect(openStreamCount()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("sign-out and per-user limits", () => {
  it("closes streams when webui.sessionEpoch is bumped", () => {
    const { close } = watch(GRANTED);
    state.cfg.webui.sessionEpoch = 1;
    vi.advanceTimersByTime(REVALIDATE_INTERVAL_MS);
    expect(close).toHaveBeenCalledWith(expect.objectContaining({ reason: "revoked" }));
  });

  it("counts a user's open streams", () => {
    const a = watch(GRANTED);
    const b = watch(GRANTED);
    const c = watch(ADMIN);
    expect(openStreamsForUser(GRANTED)).toBe(2);
    a.stop();
    b.stop();
    c.stop();
    expect(openStreamsForUser(GRANTED)).toBe(0);
  });
});
