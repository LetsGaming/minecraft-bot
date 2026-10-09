/**
 * Config migration tests.
 *
 * tests/fixtures/config/ holds config.json formats reconstructed from git
 * history of config_structure.json / config.template.json (hash in brackets):
 *
 *   f01 [dcb9373] flat single server       f02 [aa1e71a] + commands
 *   f03 [252e578] + RCON                   f04 [679e8c4] servers + guilds
 *   f04b [0704377] + adminUsers            f05 [08d1619] TypeScript rewrite
 *   f06 [1e3c3cd] remote instance entry    f07 [5e2bef2] guild admins, bridges
 *   f08 [a44c128] webui, schedules         f09 [d703f30] last 4.x structure
 *   f10 [331a7dc] last pre-5.0 commit      f11 [2ec11bc] 5.0.0 template
 *   f12..f16 [cf640af..3c3c4f7] f11 plus the additive keys those commits added
 *   f17 current config.template.json
 *
 * The config_structure.json in the repo never changed after 5.0.0, so the
 * additive-key fixtures are the 5.0.0 template with those keys applied.
 * Values are placeholders; there are no secrets.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CURRENT_CONFIG_VERSION,
  ConfigMigrationError,
  runConfigMigrations,
  stampConfigVersion,
  type ConfigMigrator,
} from "../../src/core/configMigrations.js";
import { validateCandidateConfig } from "../../src/core/configValidation.js";

vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const FIXTURE_DIR = fileURLToPath(new URL("../fixtures/config/", import.meta.url));

function readFixtureText(name: string): string {
  return fs.readFileSync(path.join(FIXTURE_DIR, `${name}.json`), "utf-8");
}

/** Templates carry ${PLACEHOLDER} values; swap in values that validate. */
function fill(text: string): string {
  return text
    .replace(/\$\{MC_API_URL\}/g, "http://192.168.1.10:3030")
    .replace(/\$\{MC_API_KEY\}/g, "wrapper-key")
    .replace(/\$\{DISCORD_TOKEN\}/g, "test.bot.token.12345")
    .replace(/\$\{[A-Z_]+\}/g, "123456789012345678");
}

const noEnv = { env: {} };

const MIGRATES: string[] = [
  "f11-v5.0.0",
  "f12-ping-settings",
  "f13-timezone-nudges",
  "f14-webui-grants",
  "f15-public-address-modpack",
  "f16-leaderboard-post-time",
  "f17-current-template",
];

/** Fixture -> servers that must be listed as needing apiUrl and apiKey. */
const NEEDS_WRAPPER: Record<string, string[]> = {
  "f01-flat-single-server": ["default"],
  "f02-flat-with-commands": ["default"],
  "f03-flat-with-rcon": ["default"],
  "f04-multi-server-guilds": ["survival", "creative"],
  "f04b-multi-server-admin-users": ["survival", "creative"],
  "f05-typescript-rewrite": ["survival", "creative"],
  "f06-remote-instance": ["survival", "creative"],
  "f07-guild-admins-bridges": ["survival", "creative"],
  "f08-webui-schedules": ["survival", "creative"],
  "f09-last-4x": ["survival", "creative"],
  "f10-last-pre-5": ["survival", "creative"],
};

describe("runConfigMigrations on historical fixtures", () => {
  it.each(MIGRATES)("%s migrates to a config that validates", (name) => {
    const parsed = JSON.parse(fill(readFixtureText(name)));
    const result = runConfigMigrations(parsed, noEnv);
    expect(result.fromVersion).toBe(0);
    expect(result.applied.map((a) => a.to)).toEqual([CURRENT_CONFIG_VERSION]);
    expect(result.config.configVersion).toBe(CURRENT_CONFIG_VERSION);
    const check = validateCandidateConfig(result.config);
    expect(check.errors).toEqual([]);
    expect(check.valid).toBe(true);
  });

  it("puts configVersion directly after $schema", () => {
    const parsed = JSON.parse(fill(readFixtureText("f17-current-template")));
    const keys = Object.keys(runConfigMigrations(parsed, noEnv).config);
    expect(keys.slice(0, 2)).toEqual(["$schema", "configVersion"]);
  });

  it.each(Object.entries(NEEDS_WRAPPER))(
    "%s stops and names every missing wrapper setting",
    (name, ids) => {
      const parsed = JSON.parse(readFixtureText(name));
      let message = "";
      try {
        runConfigMigrations(parsed, noEnv);
      } catch (err) {
        expect(err).toBeInstanceOf(ConfigMigrationError);
        message = (err as Error).message;
      }
      expect(message).not.toBe("");
      for (const id of ids) {
        expect(message).toContain(`servers.${id}.apiUrl`);
        expect(message).toContain(`servers.${id}.apiKey`);
      }
      expect(message).toContain("migrating-to-5.md");
      expect(message).toContain("left unchanged");
    },
  );

  it("does not demand the remote entry of f06, which already has a wrapper", () => {
    const parsed = JSON.parse(readFixtureText("f06-remote-instance"));
    try {
      runConfigMigrations(parsed, noEnv);
    } catch (err) {
      expect((err as Error).message).not.toContain("remote-example");
    }
  });

  it("describes the flat layout as the single-server format", () => {
    const parsed = JSON.parse(readFixtureText("f03-flat-with-rcon"));
    expect(() => runConfigMigrations(parsed, noEnv)).toThrow(
      /single-server format/,
    );
  });

  it("migrates a 4.x config once the wrapper settings are present", () => {
    const parsed = JSON.parse(readFixtureText("f09-last-4x"));
    for (const id of ["survival", "creative"]) {
      parsed.servers[id].apiUrl = "http://192.168.1.10:3030";
      parsed.servers[id].apiKey = "wrapper-key";
    }
    const { config, applied } = runConfigMigrations(parsed, noEnv);
    expect(applied[0]!.changes.join("\n")).toContain("servers.survival: removed");
    const survival = (config.servers as Record<string, Record<string, unknown>>)[
      "survival"
    ]!;
    for (const field of [
      "serverDir",
      "scriptDir",
      "linuxUser",
      "screenSession",
      "useRcon",
      "rconHost",
      "rconPort",
      "rconPassword",
    ]) {
      expect(survival).not.toHaveProperty(field);
    }
    expect(survival["commands"]).toEqual({ slime: { enabled: true } });
    expect(validateCandidateConfig(config).errors).toEqual([]);
  });

  it("wraps a flat config that already names its wrapper into servers.default", () => {
    const flat = {
      token: "t",
      clientId: "c",
      serverDir: "/srv/mc",
      linuxUser: "mc",
      apiUrl: "http://192.168.1.10:3030",
      apiKey: "k",
    };
    const { config } = runConfigMigrations(flat, noEnv);
    expect(config.servers).toEqual({
      default: { apiUrl: "http://192.168.1.10:3030", apiKey: "k" },
    });
    expect(config).not.toHaveProperty("serverDir");
    expect(config).not.toHaveProperty("apiUrl");
  });

  it("accepts an apiKey supplied through the environment", () => {
    const parsed = JSON.parse(readFixtureText("f09-last-4x"));
    for (const id of ["survival", "creative"]) {
      parsed.servers[id].apiUrl = "http://192.168.1.10:3030";
    }
    expect(() => runConfigMigrations(parsed, noEnv)).toThrow(/apiKey/);
    expect(() =>
      runConfigMigrations(parsed, { env: { API_KEY: "from-env" } }),
    ).not.toThrow();
    expect(() =>
      runConfigMigrations(parsed, {
        env: { API_KEY_SURVIVAL: "a", API_KEY_CREATIVE: "b" },
      }),
    ).not.toThrow();
  });

  it("does not mutate its input", () => {
    const parsed = JSON.parse(fill(readFixtureText("f17-current-template")));
    const copy = structuredClone(parsed);
    runConfigMigrations(parsed, noEnv);
    expect(parsed).toEqual(copy);
  });
});

describe("runConfigMigrations versioning", () => {
  it("is a no-op for a config at the current version", () => {
    const current = { configVersion: CURRENT_CONFIG_VERSION, token: "t" };
    const result = runConfigMigrations(current, noEnv);
    expect(result.applied).toEqual([]);
    expect(result.config).toBe(current);
  });

  it("is idempotent", () => {
    const parsed = JSON.parse(fill(readFixtureText("f17-current-template")));
    const once = runConfigMigrations(parsed, noEnv).config;
    const twice = runConfigMigrations(once, noEnv);
    expect(twice.applied).toEqual([]);
    expect(twice.config).toEqual(once);
  });

  it("rejects a version newer than the code", () => {
    expect(() =>
      runConfigMigrations({ configVersion: CURRENT_CONFIG_VERSION + 1 }, noEnv),
    ).toThrow(/newer release/);
  });

  it.each([-1, 1.5, "1", null])("rejects configVersion %j", (bad) => {
    expect(() => runConfigMigrations({ configVersion: bad }, noEnv)).toThrow(
      ConfigMigrationError,
    );
  });

  it("chains migrators in order and reports each step", () => {
    const steps: ConfigMigrator[] = [
      {
        from: 0,
        to: 1,
        describe: "first",
        migrate: (raw) => ({ config: { ...raw, a: 1 }, changes: ["added a"] }),
      },
      {
        from: 1,
        to: 2,
        describe: "second",
        migrate: (raw) => ({ config: { ...raw, b: 2 }, changes: ["added b"] }),
      },
    ];
    const result = runConfigMigrations({}, noEnv, steps, 2);
    expect(result.applied.map((a) => [a.from, a.to, a.changes[0]])).toEqual([
      [0, 1, "added a"],
      [1, 2, "added b"],
    ]);
    expect(result.config).toEqual({ configVersion: 2, a: 1, b: 2 });
  });

  it("reports a gap in the migrator chain", () => {
    expect(() => runConfigMigrations({}, noEnv, [], 1)).toThrow(
      /no migration from configVersion 0/,
    );
  });

  it("refuses a non-object root", () => {
    expect(() => runConfigMigrations([], noEnv)).toThrow(ConfigMigrationError);
  });
});

describe("stampConfigVersion", () => {
  it("keeps an existing key where it is", () => {
    const stamped = stampConfigVersion({ token: "t", configVersion: 0, x: 1 });
    expect(Object.keys(stamped)).toEqual(["token", "configVersion", "x"]);
    expect(stamped.configVersion).toBe(CURRENT_CONFIG_VERSION);
  });
});

describe("loadConfig migration", () => {
  let dir: string;
  let configPath: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcbot-migrate-"));
    configPath = path.join(dir, "config.json");
    vi.clearAllMocks();
    vi.stubEnv("MCBOT_CONFIG_PATH", configPath);
    vi.stubEnv("API_KEY", "");
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const backups = (): string[] =>
    fs.readdirSync(dir).filter((f) => f.startsWith("config.json.bak-v"));

  async function load() {
    return import("../../src/core/config.js");
  }

  it("backs up the original, then writes the migrated file", async () => {
    const original = fill(readFixtureText("f11-v5.0.0"));
    fs.writeFileSync(configPath, original);
    const writes: string[] = [];
    const real = fs.writeFileSync;
    vi.spyOn(fs, "writeFileSync").mockImplementation(((p: fs.PathOrFileDescriptor, ...rest: unknown[]) => {
      writes.push(String(p));
      return (real as (...a: unknown[]) => void)(p, ...rest);
    }) as typeof fs.writeFileSync);

    const { loadConfig } = await load();
    const cfg = loadConfig();

    expect(cfg.configVersion).toBe(CURRENT_CONFIG_VERSION);
    expect(writes[0]).toMatch(/config\.json\.bak-v0-\d{8}T\d{6}Z$/);
    expect(writes[1]).toBe(`${configPath}.tmp`);
    const [backup] = backups();
    expect(backup).toMatch(/^config\.json\.bak-v0-/);
    expect(fs.readFileSync(path.join(dir, backup!), "utf-8")).toBe(original);
    const written = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    expect(written.configVersion).toBe(CURRENT_CONFIG_VERSION);
    expect(fs.existsSync(`${configPath}.tmp`)).toBe(false);
  });

  it("logs one line per applied migrator", async () => {
    fs.writeFileSync(configPath, fill(readFixtureText("f11-v5.0.0")));
    const { log } = await import("../../src/core/utils/logger.js");
    (await load()).loadConfig();
    const lines = vi
      .mocked(log.info)
      .mock.calls.map((c) => String(c[1]))
      .filter((m) => m.startsWith("Migrated config v0 -> v1"));
    expect(lines).toHaveLength(1);
  });

  it("does not migrate again on the second load", async () => {
    fs.writeFileSync(configPath, fill(readFixtureText("f11-v5.0.0")));
    (await load()).loadConfig();
    const afterFirst = fs.readFileSync(configPath, "utf-8");
    vi.resetModules();
    (await load()).loadConfig();
    expect(fs.readFileSync(configPath, "utf-8")).toBe(afterFirst);
    expect(backups()).toHaveLength(1);
  });

  it("leaves the file and directory untouched when a migrator fails", async () => {
    const original = readFixtureText("f09-last-4x");
    fs.writeFileSync(configPath, original);
    const { loadConfig } = await load();
    expect(() => loadConfig()).toThrow(/servers\.survival\.apiUrl/);
    expect(fs.readFileSync(configPath, "utf-8")).toBe(original);
    expect(fs.readdirSync(dir)).toEqual(["config.json"]);
  });

  it("refuses a configVersion newer than the code", async () => {
    const original = JSON.stringify({
      configVersion: CURRENT_CONFIG_VERSION + 1,
      token: "t",
      clientId: "c",
    });
    fs.writeFileSync(configPath, original);
    const { loadConfig } = await load();
    expect(() => loadConfig()).toThrow(/configVersion/);
    expect(fs.readFileSync(configPath, "utf-8")).toBe(original);
    expect(backups()).toEqual([]);
  });

  it("keeps the file when the backup cannot be written", async () => {
    const original = fill(readFixtureText("f11-v5.0.0"));
    fs.writeFileSync(configPath, original);
    const real = fs.writeFileSync;
    vi.spyOn(fs, "writeFileSync").mockImplementation(((p: fs.PathOrFileDescriptor, ...rest: unknown[]) => {
      if (String(p).includes(".bak-v")) throw new Error("EROFS");
      return (real as (...a: unknown[]) => void)(p, ...rest);
    }) as typeof fs.writeFileSync);
    const { loadConfig } = await load();
    expect(loadConfig().configVersion).toBe(CURRENT_CONFIG_VERSION);
    expect(fs.readFileSync(configPath, "utf-8")).toBe(original);
  });
});
