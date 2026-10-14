/**
 * config.ts tests
 *
 * Uses a real temp config.json under the OS temp directory.
 * getRootDir is mocked to point there so CONFIG_PATH resolves correctly.
 * Because config.ts has module-level constants (CONFIG_PATH = getRootDir() + /config.json),
 * the mock is installed BEFORE importing config.ts, with the directory
 * computed in vi.hoisted so the factory can reference it.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { writeFileSync, mkdirSync, copyFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const TEST_ROOT = await vi.hoisted(async () => {
  const os = await import("node:os");
  const nodePath = await import("node:path");
  return nodePath.join(os.tmpdir(), `config-test-${process.pid}`);
});

// Must use a plain string literal in the factory (no variable closures)
vi.mock("../../src/core/utils/jsonStore.js", () => ({
  loadJson: vi.fn(),
  saveJson: vi.fn(),
}));

vi.mock("../../src/core/utils/paths.js", () => ({
  getRootDir: () => TEST_ROOT,
}));

import {
  loadConfig,
  reloadConfig,
  getServerIds,
} from "../../src/core/config.js";

const minimalServers = {
  s: { apiUrl: "http://127.0.0.1:3030", apiKey: "k" },
};

const validConfig = {
  token: "test.bot.token.12345",
  clientId: "123456789012345678",
  servers: {
    survival: { apiUrl: "http://192.168.1.10:3030", apiKey: "k1" },
    creative: { apiUrl: "http://192.168.1.11:3030", apiKey: "k2" },
  },
  guilds: {
    guild1: { defaultServer: "survival" },
    guild2: { defaultServer: "creative" },
  },
  adminUsers: ["admin123"],
  tpsWarningThreshold: 18,
  tpsPollIntervalMs: 30000,
  leaderboardInterval: "daily",
};

function writeConfig(cfg: object): void {
  writeFileSync(path.join(TEST_ROOT, "config.json"), JSON.stringify(cfg, null, 2));
}

beforeAll(() => {
  mkdirSync(TEST_ROOT, { recursive: true });
  // getRootDir is mocked to this directory, and the validator reads
  // config.schema.json from the root — so the fake root needs it too.
  copyFileSync(
    fileURLToPath(new URL("../../config.schema.json", import.meta.url)),
    path.join(TEST_ROOT, "config.schema.json"),
  );
});

beforeEach(() => {
  writeConfig(validConfig);
  reloadConfig(); // reset the module-level cache
});

// ── loadConfig ─────────────────────────────────────────────────────────────

describe("loadConfig", () => {
  it("returns a frozen BotConfig object", () => {
    const cfg = loadConfig();
    expect(cfg).toBeTruthy();
    expect(cfg.token).toBe("test.bot.token.12345");
    expect(cfg.clientId).toBe("123456789012345678");
  });

  it("resolves server configs from the servers object", () => {
    const cfg = loadConfig();
    expect(cfg.servers).toHaveProperty("survival");
    expect(cfg.servers["survival"]!.id).toBe("survival");
  });

  it("includes adminUsers from config", () => {
    const cfg = loadConfig();
    expect(cfg.adminUsers).toContain("admin123");
  });

  it("defaults tpsWarningThreshold to 15 when not set", () => {
    writeConfig({ token: "tok", clientId: "cid", servers: minimalServers });
    reloadConfig();
    expect(loadConfig().tpsWarningThreshold).toBe(15);
  });

  it("defaults tpsPollIntervalMs to 60000 when not set", () => {
    writeConfig({ token: "tok", clientId: "cid", servers: minimalServers });
    reloadConfig();
    expect(loadConfig().tpsPollIntervalMs).toBe(60_000);
  });

  it("returns cached result on second call (does not re-read file)", () => {
    const cfg1 = loadConfig();
    writeConfig({ token: "changed", clientId: "changed" });
    const cfg2 = loadConfig();
    expect(cfg1).toBe(cfg2); // same object reference
    expect(cfg2.token).toBe("test.bot.token.12345"); // still original
  });

  it("keeps the last good config when a reload fails (AUD-007)", () => {
    const before = loadConfig();
    writeFileSync(path.join(TEST_ROOT, "config.json"), "INVALID JSON !!!{{{");
    expect(() => reloadConfig()).toThrow("Failed to load config.json");
    expect(loadConfig()).toBe(before);
  });

  it("throws when config.json contains invalid JSON", () => {
    writeFileSync(path.join(TEST_ROOT, "config.json"), "INVALID JSON !!!{{{");
    expect(() => reloadConfig()).toThrow("Failed to load config.json");
  });

  it("throws on validation failure — missing token", () => {
    writeConfig({ clientId: "cid" });
    expect(() => reloadConfig()).toThrow("token: required");
  });

  it("throws on validation failure — missing clientId", () => {
    writeConfig({ token: "tok" });
    expect(() => reloadConfig()).toThrow("clientId: required");
  });

  it("names the migration when handed a 4.x server block", () => {
    // The fields that configured local mode. Reporting a bare "apiUrl is
    // required" at a config that was correct for the previous major tells
    // the reader nothing about what happened or where the settings went.
    writeConfig({
      token: "tok",
      clientId: "cid",
      servers: { srv: { serverDir: "/srv/mc", linuxUser: "mc", useRcon: true } },
    });
    expect(() => reloadConfig()).toThrow(/removed in 5\.0\.0/);
    expect(() => reloadConfig()).toThrow(/serverDir/);
    expect(() => reloadConfig()).toThrow(/4\.3\.x/);
  });

  it("requires apiUrl on every server", () => {
    writeConfig({ token: "tok", clientId: "cid", servers: { srv: {} } });
    expect(() => reloadConfig()).toThrow(/apiUrl: required/);
  });

  it("requires apiKey on every server", () => {
    writeConfig({
      token: "tok",
      clientId: "cid",
      servers: { srv: { apiUrl: "http://192.168.1.10:3030" } },
    });
    expect(() => reloadConfig()).toThrow(/apiKey: required/);
  });

  it("accepts apiKey from the environment instead of the file", () => {
    // The documented secrets path: the key never touches config.json.
    writeConfig({
      token: "tok",
      clientId: "cid",
      servers: { srv: { apiUrl: "http://192.168.1.10:3030" } },
    });
    process.env.API_KEY_SRV = "from-env";
    try {
      reloadConfig();
      expect(loadConfig().servers["srv"]!.apiKey).toBe("from-env");
    } finally {
      delete process.env.API_KEY_SRV;
    }
  });

  it("throws when tpsWarningThreshold is zero", () => {
    writeConfig({ token: "tok", clientId: "cid", tpsWarningThreshold: 0 });
    expect(() => reloadConfig()).toThrow("tpsWarningThreshold");
  });

  it("applies env var override for DISCORD_TOKEN", () => {
    process.env.DISCORD_TOKEN = "env-token";
    reloadConfig();
    const cfg = loadConfig();
    expect(cfg.token).toBe("env-token");
    delete process.env.DISCORD_TOKEN;
    reloadConfig();
  });

  it("boots when the token is supplied ONLY via env (config omits it) [BUG-01]", () => {
    // The documented Docker/K8s path: config.json carries no secret, the
    // token arrives via DISCORD_TOKEN. Validation must see the override, so
    // env overrides have to run before the required-field check.
    writeConfig({ clientId: "cid", servers: { s: { apiUrl: "http://127.0.0.1:3030", apiKey: "k" } } });
    process.env.DISCORD_TOKEN = "secret-from-env";
    try {
      const cfg = reloadConfig();
      expect(cfg.token).toBe("secret-from-env");
    } finally {
      delete process.env.DISCORD_TOKEN;
    }
  });

  it("still fails boot when the token is absent from both config and env", () => {
    writeConfig({ clientId: "cid" });
    delete process.env.DISCORD_TOKEN;
    expect(() => reloadConfig()).toThrow("token");
  });

  it("applies an env-only API key before validation too (BUG-01)", () => {
    // Validation requires apiKey. If it ran before the override, a
    // deployment that supplies the key only via the environment — the
    // documented path — would be rejected for missing the very value the
    // override was about to fill in.
    writeConfig({
      token: "tok",
      clientId: "cid",
      servers: { s: { apiUrl: "http://127.0.0.1:3030" } },
    });
    process.env.API_KEY = "env-secret";
    try {
      const cfg = reloadConfig();
      expect(cfg.servers["s"]!.apiKey).toBe("env-secret");
    } finally {
      delete process.env.API_KEY;
    }
  });

  it("names the migration for the pre-5.0.0 single-server format", () => {
    // The top-level object used to double as one server block. It only ever
    // held local fields, so this config cannot be silently carried forward.
    writeConfig({
      token: "tok",
      clientId: "cid",
      serverDir: "/tmp/legacy-server",
      linuxUser: "mc",
    });
    expect(() => reloadConfig()).toThrow(/single-server format/);
    expect(() => reloadConfig()).toThrow(/migrating-to-5\.md/);
  });

  it("requires a servers map", () => {
    writeConfig({ token: "tok", clientId: "cid" });
    expect(() => reloadConfig()).toThrow(/servers: required/);
  });
});

// ── reloadConfig ───────────────────────────────────────────────────────────

describe("reloadConfig", () => {
  it("re-reads the file and returns fresh config", () => {
    loadConfig(); // prime the cache
    writeConfig({ ...validConfig, tpsWarningThreshold: 20 });
    const cfg = reloadConfig();
    expect(cfg.tpsWarningThreshold).toBe(20);
  });
});

// ── getServerIds ───────────────────────────────────────────────────────────

describe("getServerIds", () => {
  it("returns all configured server IDs", () => {
    const ids = getServerIds();
    expect(ids).toContain("survival");
    expect(ids).toContain("creative");
  });
});
