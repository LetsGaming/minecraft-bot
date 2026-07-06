/**
 * config.ts tests
 *
 * Uses a real temp config.json at /tmp/config-test/config.json.
 * getRootDir is mocked to point there so CONFIG_PATH resolves correctly.
 * Because config.ts has module-level constants (CONFIG_PATH = getRootDir() + /config.json),
 * we must mock BEFORE importing config.ts, and use a plain string literal.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { writeFileSync, mkdirSync } from "fs";

// Must use a plain string literal in the factory (no variable closures)
vi.mock("../src/core/utils/utils.js", () => ({
  getRootDir: () => "/tmp/config-test",
  loadJson: vi.fn(),
  saveJson: vi.fn(),
}));

import {
  loadConfig,
  reloadConfig,
  getServer,
  getGuildServerId,
  getGuildConfig,
  getServerIds,
  getServerChoices,
} from "../src/core/config.js";

const validConfig = {
  token: "test.bot.token.12345",
  clientId: "123456789012345678",
  servers: {
    survival: { serverDir: "/tmp/fake-server", linuxUser: "mc" },
    creative: { serverDir: "/tmp/creative-server", linuxUser: "mc" },
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
  writeFileSync("/tmp/config-test/config.json", JSON.stringify(cfg, null, 2));
}

beforeAll(() => {
  mkdirSync("/tmp/config-test", { recursive: true });
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
    writeConfig({ token: "tok", clientId: "cid" });
    reloadConfig();
    expect(loadConfig().tpsWarningThreshold).toBe(15);
  });

  it("defaults tpsPollIntervalMs to 60000 when not set", () => {
    writeConfig({ token: "tok", clientId: "cid" });
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

  it("throws when config.json contains invalid JSON", () => {
    writeFileSync("/tmp/config-test/config.json", "INVALID JSON !!!{{{");
    expect(() => reloadConfig()).toThrow("Failed to load config.json");
  });

  it("throws on validation failure — missing token", () => {
    writeConfig({ clientId: "cid" });
    expect(() => reloadConfig()).toThrow("token: required string");
  });

  it("throws on validation failure — missing clientId", () => {
    writeConfig({ token: "tok" });
    expect(() => reloadConfig()).toThrow("clientId: required string");
  });

  it("throws when rconPort is out of range", () => {
    writeConfig({
      token: "tok",
      clientId: "cid",
      servers: { srv: { rconPort: 99999 } },
    });
    expect(() => reloadConfig()).toThrow("rconPort");
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

  it("uses legacy single-server format when no servers key", () => {
    writeConfig({
      token: "tok",
      clientId: "cid",
      serverDir: "/tmp/legacy-server",
      linuxUser: "mc",
    });
    reloadConfig();
    const cfg = loadConfig();
    expect(cfg.servers["default"]).toBeTruthy();
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

// ── getServer ──────────────────────────────────────────────────────────────

describe("getServer", () => {
  it("returns the server config for an existing ID", () => {
    const srv = getServer("survival");
    expect(srv).not.toBeNull();
    expect(srv!.id).toBe("survival");
  });

  it("returns null for an unknown server ID", () => {
    expect(getServer("unknown-server")).toBeNull();
  });
});

// ── getGuildServerId ───────────────────────────────────────────────────────

describe("getGuildServerId", () => {
  it("returns the defaultServer for a configured guild", () => {
    expect(getGuildServerId("guild1")).toBe("survival");
  });

  it("returns the first configured server for an unknown guild (fallback)", () => {
    // getGuildServerId falls back to the first server when guild is not found
    const result = getGuildServerId("unknown-guild");
    expect(result).toBe("survival"); // first server in validConfig
  });

  it("returns null when guildId is undefined", () => {
    expect(getGuildServerId(undefined)).toBeNull();
  });
});

// ── getGuildConfig ─────────────────────────────────────────────────────────

describe("getGuildConfig", () => {
  it("returns the guild config for a known guild", () => {
    const gcfg = getGuildConfig("guild1");
    expect(gcfg).not.toBeNull();
    expect(gcfg!.defaultServer).toBe("survival");
  });

  it("returns null for an unknown guild", () => {
    expect(getGuildConfig("nope")).toBeNull();
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

// ── getServerChoices ───────────────────────────────────────────────────────

describe("getServerChoices", () => {
  it("returns name/value pairs for Discord autocomplete", () => {
    const choices = getServerChoices();
    expect(choices.length).toBeGreaterThan(0);
    expect(choices[0]).toHaveProperty("name");
    expect(choices[0]).toHaveProperty("value");
  });
});
