/**
 * DSH-01/DSH-02 — the console: deny-list policy, the fan-out hub, and the two
 * routes.
 *
 * The hub tests matter most. Its whole reason for existing is that the wrapper
 * caps concurrent log-stream clients per instance, so "N viewers, one upstream"
 * is not an optimisation, it is the thing that stops the dashboard starving the
 * bot's chat bridge.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

process.env.WEBUI_SESSION_SECRET = "unit-test-session-secret";
process.env.WEBUI_CLIENT_SECRET = "unit-test-client-secret";

const SYSADMIN = "111111111111111111";
const READER = "777777777777777777"; // server:read only — may watch, not type
const OPERATOR = "888888888888888888"; // + server:console

const mockConfig = {
  token: "t",
  clientId: "123456789012345678",
  adminUsers: [SYSADMIN],
  servers: { smp: { id: "smp", apiKey: "k-1" } },
  guilds: {},
  webui: {
    enabled: true,
    console: { blockedCommands: ["stop", "/OP"] },
    grants: {
      [READER]: { smp: ["server:read"] },
      [OPERATOR]: { smp: ["server:read", "server:console"] },
    },
  },
};

vi.mock("../../src/core/config.js", () => ({
  loadConfig: vi.fn(() => mockConfig),
  getServerIds: vi.fn(() => ["smp"]),
}));

// vi.mock factories are hoisted above every const in the file, so the spies
// they close over have to be created inside vi.hoisted().
const { sendCommandMock, openLogStreamMock, tailLogMock, recordAdminActionMock } = vi.hoisted(
  () => ({
    sendCommandMock: vi.fn(async () => "There are 2 players online"),
    openLogStreamMock: vi.fn(),
    tailLogMock: vi.fn(async () => ""),
    recordAdminActionMock: vi.fn(async () => {}),
  }),
);

vi.mock("../../src/core/utils/server/serverAccess.js", () => ({
  sendCommand: sendCommandMock,
  openLogStream: openLogStreamMock,
  runScript: vi.fn(),
  tailLog: tailLogMock,
  listStatsUuids: vi.fn(async () => []),
  deleteStatsFile: vi.fn(),
  readWhitelist: vi.fn(async () => []),
  readUserCache: vi.fn(async () => []),
}));

vi.mock("../../src/core/utils/server/server.js", () => ({
  getServerInstance: vi.fn((id: string) =>
    id === "smp" ? { config: { id: "smp", apiKey: "k-1" }, capabilities: null } : null,
  ),
  getAllInstances: vi.fn(() => []),
}));

vi.mock("../../src/core/utils/stores/adminAudit.js", () => ({
  loadAdminAudit: vi.fn(async () => []),
  recordAdminAction: recordAdminActionMock,
}));

vi.mock("../../src/core/utils/config/configService.js", () => ({
  readRawConfig: vi.fn(() => JSON.parse(JSON.stringify(mockConfig))),
  validateCandidate: vi.fn(() => ({ valid: true, errors: [], warnings: [] })),
  writeConfig: vi.fn(async () => ({ warnings: [], changed: true })),
  configFileHash: vi.fn(() => "h"),
}));
vi.mock("../../src/core/utils/config/configHistory.js", () => ({
  RETENTION_DAYS: 3,
  snapshotConfig: vi.fn(),
  listConfigHistory: vi.fn(() => []),
  getConfigSnapshot: vi.fn(() => null),
}));
vi.mock("../../src/core/utils/stores/uptimeTracker.js", () => ({
  getUptimeStats: vi.fn(async () => ({})),
}));
vi.mock("../../src/core/utils/server/hostResources.js", () => ({
  getHostResources: vi.fn(async () => null),
}));
vi.mock("../../src/core/utils/server/runtimeHeartbeat.js", () => ({
  readRuntimeHeartbeat: vi.fn(async () => null),
  heartbeatIsFresh: vi.fn(() => false),
}));
vi.mock("../../src/core/utils/stores/playerCountHistory.js", () => ({
  loadPlayerCountStore: vi.fn(async () => ({ version: 1, servers: {} })),
}));
vi.mock("../../src/core/utils/commands/commandManifest.js", () => ({
  readCommandManifest: vi.fn(async () => ({ slash: [], ingame: [], updatedAt: 1 })),
}));

import {
  DEFAULT_BLOCKED_COMMANDS,
  normalizeConsoleCommand,
  consoleCommandVerb,
  isBlockedConsoleCommand,
} from "../../src/schema/consoleCommands.js";
import {
  subscribe,
  viewerCount,
  closeAllConsoles,
  type ConsoleEvent,
} from "../../src/web/backend/console/consoleHub.js";
import { encodeSigned, SESSION_COOKIE } from "../../src/web/backend/auth/auth.js";
import { buildServer } from "../../src/web/backend/server.js";

function cookieFor(uid: string): string {
  return `${SESSION_COOKIE}=${encodeSigned({
    uid,
    tag: `u-${uid}`,
    guilds: [],
    exp: Date.now() + 60_000,
    gexp: Date.now() + 60_000,
  })}`;
}

/** A stand-in for SseLineStream that records start/stop and can push lines. */
function fakeStream() {
  return {
    started: 0,
    stopped: 0,
    start() {
      this.started++;
    },
    stop() {
      this.stopped++;
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  closeAllConsoles();
});

// ── DSH-02: the deny-list ───────────────────────────────────────────────────

describe("console command policy", () => {
  it("strips leading slashes and case when normalising", () => {
    expect(normalizeConsoleCommand("  //STOP now ")).toBe("stop now");
    expect(consoleCommandVerb("/Stop")).toBe("stop");
  });

  it("blocks a command however it is spelled", () => {
    // The bypass the old implementation shipped with: a deny entry of "stop"
    // did nothing against "/stop", which Minecraft accepts just as happily.
    for (const spelling of ["stop", "/stop", "//stop", "STOP", "  /Stop  "]) {
      expect(isBlockedConsoleCommand(spelling, ["stop"])).toBe(true);
    }
  });

  it("normalises the deny-list entries too", () => {
    expect(isBlockedConsoleCommand("op Steve", ["/OP"])).toBe(true);
  });

  it("matches the verb, not a prefix", () => {
    // A prefix match would block a plugin's /stopwatch because /stop is
    // denied, which is the kind of surprise that gets deny-lists switched off.
    expect(isBlockedConsoleCommand("stopwatch start", ["stop"])).toBe(false);
    expect(isBlockedConsoleCommand("opendoor", ["op"])).toBe(false);
  });

  it("blocks a denied verb with arguments", () => {
    expect(isBlockedConsoleCommand("op Notch", ["op"])).toBe(true);
  });

  it("allows everything against an empty list", () => {
    expect(isBlockedConsoleCommand("stop", [])).toBe(false);
  });

  it("defaults to blocking stop/op/deop", () => {
    for (const cmd of DEFAULT_BLOCKED_COMMANDS) {
      expect(isBlockedConsoleCommand(cmd)).toBe(true);
    }
    expect(isBlockedConsoleCommand("list")).toBe(false);
  });

  it("treats an empty command as not blocked", () => {
    // Emptiness is a 400 from the schema, not a policy decision.
    expect(isBlockedConsoleCommand("   ", ["stop"])).toBe(false);
  });
});

// ── DSH-01: the fan-out hub ─────────────────────────────────────────────────

describe("consoleHub", () => {
  const cfg = { id: "smp", apiKey: "k-1" } as never;

  it("opens exactly one upstream for many viewers", () => {
    const stream = fakeStream();
    openLogStreamMock.mockReturnValue(stream);

    const a = subscribe(cfg, () => {});
    const b = subscribe(cfg, () => {});
    const c = subscribe(cfg, () => {});

    // The point of the hub: three browsers, one client from the wrapper's
    // side, so the per-instance SSE cap is not consumed by the dashboard.
    expect(openLogStreamMock).toHaveBeenCalledTimes(1);
    expect(viewerCount("smp")).toBe(3);
    a(); b(); c();
  });

  it("closes the upstream when the last viewer leaves", () => {
    const stream = fakeStream();
    openLogStreamMock.mockReturnValue(stream);

    const a = subscribe(cfg, () => {});
    const b = subscribe(cfg, () => {});
    a();
    expect(stream.stopped).toBe(0); // one viewer left
    b();
    expect(stream.stopped).toBe(1);
    expect(viewerCount("smp")).toBe(0);
  });

  it("fans a line out to every viewer", () => {
    const stream = fakeStream();
    let emit: (line: string) => void = () => {};
    openLogStreamMock.mockImplementation((_cfg, handlers) => {
      emit = handlers.onLine;
      return stream;
    });

    const seenA: string[] = [];
    const seenB: string[] = [];
    const a = subscribe(cfg, (e) => e.type === "line" && seenA.push(e.line));
    const b = subscribe(cfg, (e) => e.type === "line" && seenB.push(e.line));

    emit("hello");
    expect(seenA).toEqual(["hello"]);
    expect(seenB).toEqual(["hello"]);
    a(); b();
  });

  it("primes the backlog from the log tail before the stream starts", async () => {
    // The bug this pins: the SSE stream only carries lines written after it
    // connects, so the FIRST viewer used to see an empty pane until the server
    // next said something — which reads as broken, not idle.
    const stream = fakeStream();
    openLogStreamMock.mockReturnValue(stream);
    tailLogMock.mockResolvedValue("old line 1\nold line 2\n");

    const seen: ConsoleEvent[] = [];
    const off = subscribe(cfg, (e) => seen.push(e));

    // Priming is one HTTP round trip; the stream must not start before it.
    expect(stream.started).toBe(0);
    await new Promise((r) => setTimeout(r, 0));

    expect(seen.filter((e) => e.type === "line").map((e) => (e as { line: string }).line))
      .toEqual(["old line 1", "old line 2"]);
    expect(stream.started).toBe(1);
    expect(tailLogMock).toHaveBeenCalledWith(expect.anything(), 100);
    off();
  });

  it("still opens the live stream when the tail cannot be fetched", async () => {
    // A missing backlog is a worse console, not a broken one.
    const stream = fakeStream();
    openLogStreamMock.mockReturnValue(stream);
    tailLogMock.mockRejectedValue(new Error("wrapper unreachable"));

    const off = subscribe(cfg, () => {});
    await new Promise((r) => setTimeout(r, 0));
    expect(stream.started).toBe(1);
    off();
  });

  it("replays the backlog to a viewer who joins late", () => {
    const stream = fakeStream();
    let emit: (line: string) => void = () => {};
    openLogStreamMock.mockImplementation((_cfg, handlers) => {
      emit = handlers.onLine;
      return stream;
    });

    const first = subscribe(cfg, () => {});
    emit("earlier line");

    const seen: ConsoleEvent[] = [];
    const second = subscribe(cfg, (e) => seen.push(e));
    // Opening a console on a quiet server should not look broken.
    expect(seen[0]).toEqual({ type: "line", line: "earlier line" });
    first(); second();
  });

  it("reports connection state, and hides the upstream reason", () => {
    const stream = fakeStream();
    let handlers!: { onConnect: () => void; onDisconnect: (r: string) => void };
    openLogStreamMock.mockImplementation((_cfg, h) => {
      handlers = h;
      return stream;
    });

    const seen: ConsoleEvent[] = [];
    const off = subscribe(cfg, (e) => e.type === "state" && seen.push(e));
    handlers.onConnect();
    handlers.onDisconnect("bad response: 502 from http://wrapper:3000");

    expect(seen).toContainEqual({ type: "state", connected: true });
    const down = seen.find((e) => e.type === "state" && !e.connected);
    // The viewer learns the fact; the wrapper URL and status stay in the log.
    expect(JSON.stringify(down)).not.toContain("wrapper");
    off();
  });

  it("keeps delivering when one subscriber throws", () => {
    const stream = fakeStream();
    let emit: (line: string) => void = () => {};
    openLogStreamMock.mockImplementation((_cfg, handlers) => {
      emit = handlers.onLine;
      return stream;
    });

    const seen: string[] = [];
    const bad = subscribe(cfg, () => {
      throw new Error("dead response");
    });
    const good = subscribe(cfg, (e) => e.type === "line" && seen.push(e.line));

    expect(() => emit("still delivered")).not.toThrow();
    expect(seen).toEqual(["still delivered"]);
    bad(); good();
  });
});

// ── The routes ──────────────────────────────────────────────────────────────

describe("console routes", () => {
  it("requires server:console to send, not just server:read", () => {
    // The split that matters: watching the console and typing into it are
    // different privileges, because one command can op an account.
    return (async () => {
      const app = buildServer();
      const res = await app.inject({
        method: "POST",
        url: "/api/servers/smp/command",
        headers: { cookie: cookieFor(READER), "content-type": "application/json" },
        payload: { command: "list" },
      });
      expect(res.statusCode).toBe(403);
    })();
  });

  it("lets an operator send, and audits it", async () => {
    const app = buildServer();
    const res = await app.inject({
      method: "POST",
      url: "/api/servers/smp/command",
      headers: { cookie: cookieFor(OPERATOR), "content-type": "application/json" },
      payload: { command: "list" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().output).toContain("2 players");
    expect(recordAdminActionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "console (dashboard)",
        server: "smp",
        byId: OPERATOR,
        detail: "list",
      }),
    );
  });

  it("refuses a blocked command with 403 and never calls the wrapper", async () => {
    const app = buildServer();
    const res = await app.inject({
      method: "POST",
      url: "/api/servers/smp/command",
      headers: { cookie: cookieFor(OPERATOR), "content-type": "application/json" },
      payload: { command: "/stop" },
    });
    expect(res.statusCode).toBe(403);
    expect(sendCommandMock).not.toHaveBeenCalled();
  });

  it("strips control characters so one input cannot become two commands", async () => {
    const app = buildServer();
    await app.inject({
      method: "POST",
      url: "/api/servers/smp/command",
      headers: { cookie: cookieFor(OPERATOR), "content-type": "application/json" },
      payload: { command: "say hi\nop Notch" },
    });
    expect(sendCommandMock).toHaveBeenCalledWith(
      expect.anything(),
      "say hiop Notch",
    );
  });

  it("rejects an over-long command at the schema boundary", async () => {
    const app = buildServer();
    const res = await app.inject({
      method: "POST",
      url: "/api/servers/smp/command",
      headers: { cookie: cookieFor(OPERATOR), "content-type": "application/json" },
      payload: { command: "a".repeat(600) },
    });
    expect(res.statusCode).toBe(400);
  });

  it("serves the same deny-list the enforcement uses", async () => {
    const app = buildServer();
    const res = await app.inject({
      method: "GET",
      url: "/api/servers/smp/console/policy",
      headers: { cookie: cookieFor(READER) },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().blockedCommands).toEqual(["stop", "/OP"]);
  });

  it("404s an unknown server on the policy route", async () => {
    const app = buildServer();
    const res = await app.inject({
      method: "GET",
      url: "/api/servers/nope/console/policy",
      headers: { cookie: cookieFor(SYSADMIN) },
    });
    expect(res.statusCode).toBe(404);
  });
});
