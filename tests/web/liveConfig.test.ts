/**
 * The dashboard process keeps loadConfig()'s cache for its whole lifetime
 * unless something reloads it. These cases run the real watcher over a real
 * config.json and read the values the request path reads.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { writeFileSync, renameSync, mkdirSync, copyFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const TEST_ROOT = await vi.hoisted(async () => {
  const os = await import("node:os");
  const nodePath = await import("node:path");
  return nodePath.join(os.tmpdir(), `web-live-config-${process.pid}`);
});

vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../src/core/utils/paths.js", () => ({ getRootDir: () => TEST_ROOT }));

import { reloadConfig, stopWatchingConfig } from "../../src/core/config.js";
import { startLiveConfig, reconcileWebServers } from "../../src/web/backend/config/liveConfig.js";
import { sessionCapabilities } from "../../src/web/backend/auth/capabilities.js";
import { globalAdminIds } from "../../src/web/backend/auth/auth.js";
import {
  initServers,
  getAllInstances,
  getServerInstance,
  removeServerInstance,
} from "../../src/core/utils/server/server.js";

const CONFIG = path.join(TEST_ROOT, "config.json");
const ALICE = "111111111111111111";
const session = { uid: ALICE, tag: "alice", exp: Date.now() + 1e6, guilds: [] };

function configWith(extra: Record<string, unknown>, servers = ["s"]): object {
  return {
    configVersion: 1,
    token: "test.bot.token.12345",
    clientId: "123456789012345678",
    servers: Object.fromEntries(
      servers.map((id) => [id, { apiUrl: `http://127.0.0.1:3030/${id}`, apiKey: "k" }]),
    ),
    ...extra,
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
    if (Date.now() - start > ms) throw new Error("timed out waiting for reload");
    await new Promise((r) => setTimeout(r, 20));
  }
}

beforeAll(() => {
  mkdirSync(TEST_ROOT, { recursive: true });
  copyFileSync(
    fileURLToPath(new URL("../../config.schema.json", import.meta.url)),
    path.join(TEST_ROOT, "config.schema.json"),
  );
});

beforeEach(() => {
  for (const inst of getAllInstances()) removeServerInstance(inst.id);
});

afterEach(() => {
  stopWatchingConfig();
});

describe("dashboard live config", () => {
  it("makes a grants change visible without a restart", async () => {
    writeFileSync(CONFIG, JSON.stringify(configWith({})));
    reloadConfig();
    expect(sessionCapabilities(session, "s").has("server:read")).toBe(false);

    startLiveConfig({ debounceMs: 30 });
    save(configWith({ webui: { enabled: true, grants: { [ALICE]: { s: ["server:read"] } } } }));
    await waitFor(() => sessionCapabilities(session, "s").has("server:read"));

    save(configWith({ webui: { enabled: true, grants: {} } }));
    await waitFor(() => !sessionCapabilities(session, "s").has("server:read"));
  });

  it("applies adminUsers changes to the sysadmin set", async () => {
    writeFileSync(CONFIG, JSON.stringify(configWith({})));
    reloadConfig();
    startLiveConfig({ debounceMs: 30 });
    expect(globalAdminIds().has(ALICE)).toBe(false);

    save(configWith({ adminUsers: [ALICE] }));
    await waitFor(() => globalAdminIds().has(ALICE));
  });

  it("adds and removes servers in the registry", async () => {
    writeFileSync(CONFIG, JSON.stringify(configWith({}, ["a"])));
    const first = reloadConfig();
    initServers(first.servers);
    startLiveConfig({ debounceMs: 30 });

    save(configWith({}, ["a", "b"]));
    await waitFor(() => getServerInstance("b") !== null);

    save(configWith({}, ["b"]));
    await waitFor(() => getServerInstance("a") === null);
    expect(getAllInstances().map((i) => i.id)).toEqual(["b"]);
  });
});

describe("reconcileWebServers", () => {
  it("rebuilds an instance whose connection settings changed", () => {
    writeFileSync(CONFIG, JSON.stringify(configWith({}, ["a"])));
    initServers(reloadConfig().servers);
    const before = getServerInstance("a");

    const edited = configWith({}, ["a"]) as { servers: Record<string, { apiUrl: string }> };
    edited.servers.a!.apiUrl = "http://10.0.0.9:3030";
    writeFileSync(CONFIG, JSON.stringify(edited));
    const result = reconcileWebServers(reloadConfig());

    expect(result).toEqual({ added: [], removed: [], replaced: ["a"] });
    expect(getServerInstance("a")).not.toBe(before);
    expect(getServerInstance("a")?.config.apiUrl).toBe("http://10.0.0.9:3030");
  });
});
