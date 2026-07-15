/**
 * Remote-API offline tolerance: a server reached over the wrapper API must not
 * be reported offline on a single failed request (a timeout or a momentarily
 * busy wrapper). isRunning() retries once on a *thrown* error, but returns a
 * genuine "not running" (false) immediately — so a stopped server is still
 * reported instantly, without a wasteful extra request. Covers the four
 * callers that read server.isRunning() (dashboard status, status embed,
 * /status, downtime monitor).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../src/core/shell/execCommand.js", () => ({
  execSafe: vi.fn(),
  isSudoPermissionError: vi.fn(() => false),
}));
vi.mock("../../src/core/rcon/RconClient.js", () => ({ RconClient: vi.fn() }));
vi.mock("../../src/core/config.js", () => ({ loadConfig: vi.fn(() => ({})) }));

const isRunningMock = vi.fn();
vi.mock("../../src/core/utils/server/serverAccess.js", () => ({
  isRunning: isRunningMock,
}));

import { ServerInstance } from "../../src/core/utils/server/server.js";
import type { ServerConfig } from "../../src/core/types/index.js";

// Remote server: apiUrl set, RCON off → the wrapper-API path.
const remoteCfg = {
  id: "smp",
  apiUrl: "http://wrapper.local:3030",
  useRcon: false,
} as unknown as ServerConfig;

const inst = () => new ServerInstance(remoteCfg);

describe("ServerInstance.isRunning() — remote API offline tolerance", () => {
  beforeEach(() => isRunningMock.mockReset());

  it("reports running on a successful probe (one request)", async () => {
    isRunningMock.mockResolvedValue(true);
    expect(await inst().isRunning()).toBe(true);
    expect(isRunningMock).toHaveBeenCalledTimes(1);
  });

  it("does NOT go offline on a single failed request — retries, then succeeds", async () => {
    isRunningMock
      .mockRejectedValueOnce(new Error("ETIMEDOUT"))
      .mockResolvedValueOnce(true);
    expect(await inst().isRunning()).toBe(true);
    expect(isRunningMock).toHaveBeenCalledTimes(2);
  });

  it("reports offline only after the retry also fails", async () => {
    isRunningMock
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockRejectedValueOnce(new Error("ECONNREFUSED"));
    expect(await inst().isRunning()).toBe(false);
    expect(isRunningMock).toHaveBeenCalledTimes(2);
  });

  it("reports a genuine 'stopped' immediately, without a wasteful retry", async () => {
    isRunningMock.mockResolvedValue(false); // wrapper reachable, server stopped
    expect(await inst().isRunning()).toBe(false);
    expect(isRunningMock).toHaveBeenCalledTimes(1);
  });
});
