/**
 * The bug this file exists for: "offline" used to mean three different things.
 *
 * `isRunning()` asked the API wrapper, and anything that was not a clean
 * `true` became offline — a wrapper that was down, a wrapper that timed out,
 * and a Minecraft server that had genuinely stopped. Two of those three are
 * wrong, and they are the common ones: the wrapper is a separate process that
 * gets restarted and updated while Minecraft keeps running with players on it.
 *
 * So the cases below are mostly about *not* concluding things:
 *   - an unreachable wrapper is `unreachable`, never `offline`;
 *   - a server that is up but not answering RCON is `unresponsive`, not down;
 *   - only a wrapper that positively reports `offline` means the server stopped.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../src/core/config.js", () => ({ loadConfig: vi.fn(() => ({})) }));

const getHealthMock = vi.fn();
vi.mock("../../src/core/utils/server/serverAccess.js", () => ({
  getHealth: getHealthMock,
}));

import { ServerInstance } from "../../src/core/utils/server/server.js";
import {
  ServerState,
  RconState,
  WrapperState,
  HealthSource,
  serverIsUp,
  serverIsResponsive,
  stateIsKnown,
  wrapperIsDown,
  unknownHealth,
  type ServerHealth,
} from "../../src/schema/serverState.js";
import type { ServerConfig } from "../../src/core/types/index.js";

// Remote server: apiUrl set → the wrapper-API path (the only path since 5.0.0).
const remoteCfg = {
  id: "smp",
  apiUrl: "http://wrapper.local:3030",
} as unknown as ServerConfig;

const inst = (): ServerInstance => new ServerInstance(remoteCfg);

function health(
  state: ServerState,
  rcon: RconState = RconState.Responsive,
  wrapper: WrapperState = WrapperState.Up,
): ServerHealth {
  return {
    state,
    source: wrapper === WrapperState.Up ? HealthSource.Wrapper : HealthSource.Ping,
    wrapper,
    processUp: state !== ServerState.Offline && state !== ServerState.Unknown,
    rcon,
    probe: "socket",
    players: null,
    reason: null,
    checkedAt: Date.now(),
  };
}

describe("ServerInstance.getHealth() — retry policy", () => {
  beforeEach(() => getHealthMock.mockReset());

  it("returns a known state from the first request, without a second", async () => {
    getHealthMock.mockResolvedValue(health(ServerState.Online));
    expect((await inst().getHealth()).state).toBe(ServerState.Online);
    expect(getHealthMock).toHaveBeenCalledTimes(1);
  });

  it("retries once when nothing answered — a dropped packet is not a state change", async () => {
    getHealthMock
      .mockResolvedValueOnce(unknownHealth("ETIMEDOUT"))
      .mockResolvedValueOnce(health(ServerState.Online));
    expect((await inst().getHealth()).state).toBe(ServerState.Online);
    expect(getHealthMock).toHaveBeenCalledTimes(2);
  });

  it("stays unknown — NOT offline — when the retry also fails", async () => {
    getHealthMock.mockResolvedValue(unknownHealth("ECONNREFUSED"));
    const result = await inst().getHealth();
    expect(result.state).toBe(ServerState.Unknown);
    expect(result.state).not.toBe(ServerState.Offline);
    expect(getHealthMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry when the wrapper is down but a ping answered", async () => {
    // The case that motivated the direct ping: the wrapper is unreachable,
    // but the server itself answered a server-list ping with players on it.
    // That is a known state, so there is nothing to retry.
    getHealthMock.mockResolvedValue(
      health(ServerState.Online, RconState.Unknown, WrapperState.Unreachable),
    );
    const result = await inst().getHealth();
    expect(result.state).toBe(ServerState.Online);
    expect(wrapperIsDown(result)).toBe(true);
    expect(getHealthMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry a server the wrapper positively reports as stopped", async () => {
    // The wrapper answered. Asking again cannot improve that answer, and a
    // stopped server should be reported immediately.
    getHealthMock.mockResolvedValue(
      health(ServerState.Offline, RconState.Unresponsive),
    );
    expect((await inst().getHealth()).state).toBe(ServerState.Offline);
    expect(getHealthMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry an unresponsive server — re-probing only adds load", async () => {
    // `unresponsive` means the server is too busy to answer RCON. Probing it
    // again is the one thing guaranteed to make that worse.
    getHealthMock.mockResolvedValue(
      health(ServerState.Unresponsive, RconState.Unresponsive),
    );
    expect((await inst().getHealth()).state).toBe(ServerState.Unresponsive);
    expect(getHealthMock).toHaveBeenCalledTimes(1);
  });
});

describe("ServerInstance.isRunning() — the legacy boolean", () => {
  beforeEach(() => getHealthMock.mockReset());

  it("is true for a loaded server that is not answering", async () => {
    // The original bug, in one assertion: a lag spike used to report false.
    getHealthMock.mockResolvedValue(
      health(ServerState.Unresponsive, RconState.Unresponsive),
    );
    expect(await inst().isRunning()).toBe(true);
  });

  it("is false for a stopped server", async () => {
    getHealthMock.mockResolvedValue(health(ServerState.Offline));
    expect(await inst().isRunning()).toBe(false);
  });

  it("is false when nothing answered — a boolean cannot say 'unknown'", async () => {
    // Which is exactly why callers that report state to a human, or decide
    // whether to alert, must read getHealth() instead of this.
    getHealthMock.mockResolvedValue(unknownHealth("ECONNREFUSED"));
    expect(await inst().isRunning()).toBe(false);
  });

  it("is TRUE when the wrapper is down but the server answered a ping", async () => {
    // The bug in one assertion: the server is up with players on it, and the
    // only thing that is down is the bot's route to it.
    getHealthMock.mockResolvedValue(
      health(ServerState.Online, RconState.Unknown, WrapperState.Unreachable),
    );
    expect(await inst().isRunning()).toBe(true);
  });
});

describe("state predicates", () => {
  it("counts online and unresponsive as up, and nothing else", () => {
    expect(serverIsUp(health(ServerState.Online))).toBe(true);
    expect(serverIsUp(health(ServerState.Unresponsive))).toBe(true);
    expect(serverIsUp(health(ServerState.Offline))).toBe(false);
    expect(serverIsUp(unknownHealth("x"))).toBe(false);
  });

  it("counts only online as responsive — the bar for reading players and TPS", () => {
    expect(serverIsResponsive(health(ServerState.Online))).toBe(true);
    expect(serverIsResponsive(health(ServerState.Unresponsive))).toBe(false);
  });

  it("treats every answered state as knowledge, and total silence as not", () => {
    for (const state of [
      ServerState.Online,
      ServerState.Unresponsive,
      ServerState.Offline,
    ]) {
      expect(stateIsKnown(health(state))).toBe(true);
    }
    expect(stateIsKnown(unknownHealth("x"))).toBe(false);
  });

  it("never claims processUp for a state it did not establish", () => {
    // processUp must not be inferred from `state`: `unknown` confirmed
    // nothing, and anywhere that reads it as "stopped" reintroduces the bug.
    const unknown = unknownHealth("x");
    expect(unknown.processUp).toBe(false);
    expect(unknown.state).toBe(ServerState.Unknown);
  });

  it("keeps the wrapper axis independent of the server state", () => {
    // All four combinations are meaningful; the model must not collapse them.
    const upBothWays = health(ServerState.Online);
    const upButBlind = health(
      ServerState.Online,
      RconState.Unknown,
      WrapperState.Unreachable,
    );
    expect(wrapperIsDown(upBothWays)).toBe(false);
    expect(wrapperIsDown(upButBlind)).toBe(true);
    // Same server state, different wrapper state — and both are "up".
    expect(serverIsUp(upBothWays)).toBe(serverIsUp(upButBlind));
  });
});
