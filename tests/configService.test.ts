/**
 * configService — the programmatic config-editing layer (WebUI-ready).
 *
 * writeConfig must refuse invalid candidates (nothing touched), write
 * atomically (tmp + rename) with a .bak of the previous file, and surface
 * validation warnings. applyConfig must reload + reconcile.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

vi.mock("../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Point the service at a temp config path and keep validation controllable.
const mocks = vi.hoisted(() => ({
  getConfigPath: vi.fn<() => string>(),
  validateCandidateConfig: vi.fn(),
  reloadConfig: vi.fn(),
  reconcileServers: vi.fn(),
}));

vi.mock("../src/core/config.js", () => ({
  getConfigPath: mocks.getConfigPath,
  validateCandidateConfig: mocks.validateCandidateConfig,
  reloadConfig: mocks.reloadConfig,
}));

vi.mock("../src/bot/logWatcher/initMinecraftCommands.js", () => ({
  reconcileServers: mocks.reconcileServers,
}));

import {
  readRawConfig,
  validateCandidate,
  writeConfig,
} from "../src/core/utils/configService.js";
import { applyConfig } from "../src/bot/utils/applyConfig.js";

let dir: string;
let configPath: string;

beforeEach(() => {
  vi.clearAllMocks();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "configservice-"));
  configPath = path.join(dir, "config.json");
  mocks.getConfigPath.mockReturnValue(configPath);
  mocks.validateCandidateConfig.mockReturnValue({
    valid: true,
    errors: [],
    warnings: [],
  });
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("writeConfig", () => {
  it("refuses an invalid candidate and leaves the file untouched", async () => {
    fs.writeFileSync(configPath, '{"token":"old"}');
    mocks.validateCandidateConfig.mockReturnValue({
      valid: false,
      errors: ["  - token: required string"],
      warnings: [],
    });

    await expect(writeConfig({} as never)).rejects.toThrow(
      /Refusing to write invalid config/,
    );
    expect(fs.readFileSync(configPath, "utf-8")).toBe('{"token":"old"}');
    expect(fs.existsSync(`${configPath}.tmp`)).toBe(false);
  });

  it("skips a no-op write and reports changed:false", async () => {
    const cfg = { token: "t", clientId: "c" } as never;
    const first = await writeConfig(cfg);
    expect(first.changed).toBe(true);
    const onDisk = fs.readFileSync(configPath, "utf-8");

    // Writing the identical config again changes nothing.
    const second = await writeConfig(cfg);
    expect(second.changed).toBe(false);
    expect(fs.readFileSync(configPath, "utf-8")).toBe(onDisk);
    // No .bak is produced on a skipped write (nothing was replaced).
    expect(fs.existsSync(`${configPath}.bak`)).toBe(false);
  });

  it("treats a real edit as changed:true", async () => {
    await writeConfig({ token: "t", clientId: "c" } as never);
    const res = await writeConfig({ token: "t2", clientId: "c" } as never);
    expect(res.changed).toBe(true);
  });

  it("writes the candidate atomically and backs up the previous file", async () => {
    fs.writeFileSync(configPath, '{"token":"old"}');

    const candidate = { token: "new", clientId: "c" };
    const { warnings } = await writeConfig(candidate as never);

    expect(JSON.parse(fs.readFileSync(configPath, "utf-8"))).toEqual(
      candidate,
    );
    expect(fs.readFileSync(`${configPath}.bak`, "utf-8")).toBe(
      '{"token":"old"}',
    );
    expect(fs.existsSync(`${configPath}.tmp`)).toBe(false);
    expect(warnings).toEqual([]);
  });

  it("works without a pre-existing config and surfaces warnings", async () => {
    mocks.validateCandidateConfig.mockReturnValue({
      valid: true,
      errors: [],
      warnings: ["something minor"],
    });

    const { warnings } = await writeConfig({ token: "t" } as never);
    expect(warnings).toEqual(["something minor"]);
    expect(fs.existsSync(configPath)).toBe(true);
    expect(fs.existsSync(`${configPath}.bak`)).toBe(false);
  });

  it("maps an unwritable config path to an actionable error [BUG-04]", async () => {
    // The shipped Docker failure was a raw EACCES (config at a root-owned /
    // read-only path) surfacing as an opaque 500. A path under a nonexistent
    // parent reproduces the write failure regardless of the test's uid (root
    // bypasses chmod), and the mapped error must point at the real fix.
    const unwritable = path.join(dir, "does-not-exist", "config.json");
    mocks.getConfigPath.mockReturnValue(unwritable);

    await expect(
      writeConfig({ token: "t", clientId: "c" } as never),
    ).rejects.toThrow(/writable path/);
    await expect(
      writeConfig({ token: "t", clientId: "c" } as never),
    ).rejects.toThrow(/MCBOT_CONFIG_PATH/);
    // No stray temp file left behind by the failed write.
    expect(fs.existsSync(`${unwritable}.tmp`)).toBe(false);
  });
});

describe("readRawConfig / validateCandidate", () => {
  it("reads the raw on-disk JSON", () => {
    fs.writeFileSync(configPath, '{"token":"raw"}');
    expect(readRawConfig()).toEqual({ token: "raw" });
  });

  it("delegates validation to validateCandidateConfig", () => {
    validateCandidate({ any: "thing" });
    expect(mocks.validateCandidateConfig).toHaveBeenCalledWith({
      any: "thing",
    });
  });
});

describe("applyConfig", () => {
  it("reloads the cache and reconciles running instances", async () => {
    const fresh = { token: "t" } as never;
    mocks.reloadConfig.mockReturnValue(fresh);
    mocks.reconcileServers.mockResolvedValue({
      added: ["new"],
      removed: [],
      changed: ["old"],
    });

    const client = {} as never;
    const result = await applyConfig(client);

    expect(mocks.reloadConfig).toHaveBeenCalledOnce();
    expect(mocks.reconcileServers).toHaveBeenCalledWith(client, fresh);
    expect(result.added).toEqual(["new"]);
    expect(result.changed).toEqual(["old"]);
    expect(result.config).toBe(fresh);
  });
});
