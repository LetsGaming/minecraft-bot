/**
 * A console stream is authorized once, on connect. A config reload that
 * revokes the grant, removes the server or re-points it must end the stream
 * and release its upstream tailer, and must leave no cached data behind for a
 * server later re-added under the same id.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { writeFileSync, renameSync, mkdirSync, copyFileSync } from "fs";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import type { AddressInfo } from "net";

process.env.WEBUI_SESSION_SECRET = "unit-test-session-secret";
process.env.WEBUI_CLIENT_SECRET = "unit-test-client-secret";

const TEST_ROOT = await vi.hoisted(async () => {
  const os = await import("node:os");
  const nodePath = await import("node:path");
  return nodePath.join(os.tmpdir(), `web-live-streams-${process.pid}`);
});

const { openLogStreamMock, sendCommandMock } = vi.hoisted(() => ({
  openLogStreamMock: vi.fn(),
  sendCommandMock: vi.fn(async () => "ok"),
}));

vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../src/core/utils/paths.js", () => ({ getRootDir: () => TEST_ROOT }));
vi.mock("../../src/core/utils/server/serverAccess.js", () => ({
  sendCommand: sendCommandMock,
  openLogStream: openLogStreamMock,
  tailLog: vi.fn(async () => ""),
}));
vi.mock("../../src/core/utils/stores/adminAudit.js", () => ({
  recordAdminAction: vi.fn(async () => {}),
}));

import Fastify, { type FastifyInstance } from "fastify";
import { reloadConfig, stopWatchingConfig } from "../../src/core/config.js";
import { registerErrorHandler } from "../../src/web/backend/errors.js";
import { capabilityGate } from "../../src/web/backend/auth/capabilities.js";
import { registerConsoleRoutes } from "../../src/web/backend/routes/console.js";
import { encodeSigned, SESSION_COOKIE } from "../../src/web/backend/auth/auth.js";
import { startLiveConfig } from "../../src/web/backend/config/liveConfig.js";
import { viewerCount, closeAllConsoles } from "../../src/web/backend/console/consoleHub.js";
import { openStreamCount } from "../../src/web/backend/console/streamRegistry.js";
import {
  initServers,
  getAllInstances,
  removeServerInstance,
} from "../../src/core/utils/server/server.js";
import { cached } from "../../src/core/utils/cache.js";
import { remember, recall } from "../../src/core/utils/wrapper/lastKnown.js";

const CONFIG = path.join(TEST_ROOT, "config.json");
const READER = "777777777777777777";
const OPERATOR = "888888888888888888";

type Grants = Record<string, unknown>;
const BOTH: Grants = {
  [READER]: { smp: ["server:read"] },
  [OPERATOR]: { smp: ["server:read", "server:console"] },
};

function configWith(opts: {
  servers?: string[];
  grants?: Grants;
  blocked?: string[];
  apiUrl?: string;
}): object {
  const ids = opts.servers ?? ["smp"];
  return {
    configVersion: 1,
    token: "test.bot.token.12345",
    clientId: "123456789012345678",
    servers: Object.fromEntries(
      ids.map((id) => [id, { apiUrl: opts.apiUrl ?? "http://127.0.0.1:3030", apiKey: "k" }]),
    ),
    webui: {
      enabled: true,
      grants: opts.grants ?? BOTH,
      ...(opts.blocked ? { console: { blockedCommands: opts.blocked } } : {}),
    },
  };
}

function save(cfg: object): void {
  const tmp = `${CONFIG}.tmp`;
  writeFileSync(tmp, JSON.stringify(cfg, null, 2));
  renameSync(tmp, CONFIG);
}

async function waitFor(check: () => boolean, ms = 4000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
}

function cookieFor(uid: string): string {
  return `${SESSION_COOKIE}=${encodeSigned({
    uid,
    tag: `u-${uid}`,
    guilds: [],
    exp: Date.now() + 60_000,
    gexp: Date.now() + 60_000,
  })}`;
}

interface Watching {
  frames: string[];
  ended: Promise<void>;
  abort(): void;
}

function openStream(port: number, serverId: string, uid: string): Promise<Watching> {
  return new Promise((resolve, reject) => {
    const req = http.get(
      {
        port,
        path: `/api/servers/${serverId}/console/stream`,
        headers: { cookie: cookieFor(uid) },
      },
      (res) => {
        const frames: string[] = [];
        const ended = new Promise<void>((done) => {
          res.on("end", done);
          res.on("close", done);
        });
        res.on("data", (chunk: Buffer) => frames.push(chunk.toString()));
        resolve({ frames, ended, abort: () => req.destroy() });
      },
    );
    req.on("error", reject);
  });
}

async function postCommand(uid: string, command: string): Promise<number> {
  const res = await app.inject({
    method: "POST",
    url: "/api/servers/smp/command",
    headers: { cookie: cookieFor(uid), "content-type": "application/json" },
    payload: { command },
  });
  return res.statusCode;
}

let app: FastifyInstance;
let port: number;
let stopped: number;

beforeAll(() => {
  mkdirSync(TEST_ROOT, { recursive: true });
  copyFileSync(
    fileURLToPath(new URL("../../config.schema.json", import.meta.url)),
    path.join(TEST_ROOT, "config.schema.json"),
  );
});

beforeEach(async () => {
  stopped = 0;
  openLogStreamMock.mockImplementation(() => ({
    start: vi.fn(),
    stop: () => {
      stopped += 1;
    },
  }));
  for (const inst of getAllInstances()) removeServerInstance(inst.id);
  writeFileSync(CONFIG, JSON.stringify(configWith({})));
  initServers(reloadConfig().servers);

  app = Fastify({ logger: false });
  registerErrorHandler(app);
  app.addHook("onRequest", capabilityGate);
  registerConsoleRoutes(app);
  await app.listen({ port: 0, host: "127.0.0.1" });
  port = (app.server.address() as AddressInfo).port;
  startLiveConfig({ debounceMs: 30 });
});

afterEach(async () => {
  stopWatchingConfig();
  closeAllConsoles();
  await app.close();
});

describe("open console streams after a reload", () => {
  it("closes a stream whose grant was revoked and stops its tailer", async () => {
    const watching = await openStream(port, "smp", READER);
    await waitFor(() => openStreamCount("smp") === 1);
    expect(viewerCount("smp")).toBe(1);

    save(configWith({ grants: {} }));
    await watching.ended;

    expect(watching.frames.join("")).toContain('"reason":"revoked"');
    expect(openStreamCount()).toBe(0);
    expect(viewerCount("smp")).toBe(0);
    expect(stopped).toBe(1);

    const retry = await app.inject({
      url: "/api/servers/smp/console/stream",
      headers: { cookie: cookieFor(READER) },
    });
    expect(retry.statusCode).toBe(403);
  });

  it("keeps the streams of users who still have access", async () => {
    const keeper = await openStream(port, "smp", OPERATOR);
    const revoked = await openStream(port, "smp", READER);
    await waitFor(() => openStreamCount("smp") === 2);

    save(configWith({ grants: { [OPERATOR]: { smp: ["server:read"] } } }));
    await revoked.ended;

    expect(openStreamCount("smp")).toBe(1);
    expect(viewerCount("smp")).toBe(1);
    expect(stopped).toBe(0);
    keeper.abort();
    await waitFor(() => viewerCount("smp") === 0);
  });

  it("closes streams of a removed server, stops the tailer and drops its caches", async () => {
    await cached("status:health:smp", 60_000, async () => "old-smp");
    remember("smp", "modsInstalled", { mods: ["old"] });
    const watching = await openStream(port, "smp", READER);
    await waitFor(() => openStreamCount("smp") === 1);

    save(configWith({ servers: ["other"] }));
    await watching.ended;

    expect(watching.frames.join("")).toContain('"reason":"removed"');
    expect(viewerCount("smp")).toBe(0);
    expect(stopped).toBe(1);
    expect(recall("smp", "modsInstalled")).toBeUndefined();

    save(configWith({ servers: ["other", "smp"] }));
    await waitFor(() => getAllInstances().some((i) => i.id === "smp"));
    const fresh = await cached("status:health:smp", 60_000, async () => "new-smp");
    expect(fresh).toBe("new-smp");
  });

  it("closes streams and caches of a server whose connection settings changed", async () => {
    await cached("mods:installed:smp", 60_000, async () => "old");
    const watching = await openStream(port, "smp", READER);
    await waitFor(() => openStreamCount("smp") === 1);

    save(configWith({ apiUrl: "http://10.1.1.1:3030" }));
    await watching.ended;

    expect(watching.frames.join("")).toContain('"reason":"reconfigured"');
    expect(await cached("mods:installed:smp", 60_000, async () => "new")).toBe("new");
  });
});

describe("console deny-list", () => {
  it("is read from the live config on every command", async () => {
    expect(await postCommand(OPERATOR, "list")).toBe(200);

    save(configWith({ blocked: ["list"] }));
    await new Promise((r) => setTimeout(r, 400));
    expect(await postCommand(OPERATOR, "list")).toBe(403);

    save(configWith({ blocked: ["stop"] }));
    await new Promise((r) => setTimeout(r, 400));
    expect(await postCommand(OPERATOR, "list")).toBe(200);
  });

  it("stops a revoked operator from sending", async () => {
    save(configWith({ grants: { [OPERATOR]: { smp: ["server:read"] } } }));
    await new Promise((r) => setTimeout(r, 400));
    expect(await postCommand(OPERATOR, "list")).toBe(403);
  });
});
