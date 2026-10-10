import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  copyFileSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = vi.hoisted(
  () =>
    `${process.env["TEMP"] ?? process.env["TMPDIR"] ?? "/tmp"}/mcbot-loadconfig-keys-${process.pid}-${Math.random().toString(36).slice(2)}`,
);

vi.mock("../../src/core/utils/jsonStore.js", () => ({
  loadJson: vi.fn(),
  saveJson: vi.fn(),
}));

vi.mock("../../src/core/utils/paths.js", () => ({
  getRootDir: () => root,
}));

import { loadConfig, reloadConfig } from "../../src/core/config.js";

const schemaPath = fileURLToPath(new URL("../../config.schema.json", import.meta.url));

const SAMPLES: Record<string, unknown> = {
  configVersion: 1,
  token: "test.bot.token.12345",
  clientId: "123456789012345678",
  servers: { s: { apiUrl: "http://127.0.0.1:3030", apiKey: "k" } },
  guilds: { g1: { defaultServer: "s" } },
  adminUsers: ["admin1"],
  language: "de",
  timezone: "Europe/Berlin",
  commands: { stats: { enabled: false } },
  leaderboard: { enabled: true },
  tpsWarningThreshold: 11,
  tpsPollIntervalMs: 12_345,
  leaderboardInterval: "daily",
  leaderboardPostTime: "08:30",
  leaderboardPostDay: "monday",
  presence: { enabled: true },
  deathCoords: { enabled: true },
  hostAlerts: { enabled: true },
  waypoints: { maxPerPlayer: 3 },
  limits: { maxPollOptions: 4 },
  updateNotifier: { enabled: true },
  featureNudges: { enabled: false },
  schedules: { s: { timezone: "UTC" } },
  milestones: { s: [100] },
  webui: { enabled: true },
};

function rawConfigKeys(): string[] {
  const schema = JSON.parse(readFileSync(schemaPath, "utf-8")) as {
    definitions: { RawBotConfig: { properties: Record<string, unknown> } };
  };
  return Object.keys(schema.definitions.RawBotConfig.properties);
}

beforeEach(() => {
  mkdirSync(root, { recursive: true });
  copyFileSync(schemaPath, join(root, "config.schema.json"));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("loadConfig key coverage", () => {
  it("has a sample value for every RawBotConfig key", () => {
    expect(Object.keys(SAMPLES).sort()).toEqual(rawConfigKeys().sort());
  });

  it.each(rawConfigKeys())("carries %s from config.json into BotConfig", (key) => {
    const raw: Record<string, unknown> = {
      token: SAMPLES["token"],
      clientId: SAMPLES["clientId"],
      servers: SAMPLES["servers"],
      [key]: SAMPLES[key],
    };
    writeFileSync(join(root, "config.json"), JSON.stringify(raw));
    const cfg = reloadConfig() as unknown as Record<string, unknown>;
    expect(loadConfig()).toBe(cfg);
    expect(cfg).toHaveProperty(key);
    if (["timezone", "featureNudges", "language"].includes(key)) {
      expect(cfg[key]).toEqual(SAMPLES[key]);
    }
  });
});
