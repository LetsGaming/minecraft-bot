/**
 * watchConfig against a real directory. writeConfig replaces config.json by
 * renaming a temp file over it, so every case saves that way: a watcher bound
 * to the replaced file would only ever see the first save.
 */
import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { writeFileSync, renameSync, mkdirSync, copyFileSync, rmSync, readFileSync } from "fs";
import { createHash } from "crypto";
import path from "path";
import { fileURLToPath } from "url";

const TEST_ROOT = await vi.hoisted(async () => {
  const os = await import("node:os");
  const nodePath = await import("node:path");
  return nodePath.join(os.tmpdir(), `watch-config-test-${process.pid}`);
});

vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../src/core/utils/paths.js", () => ({ getRootDir: () => TEST_ROOT }));

import {
  watchConfig,
  stopWatchingConfig,
  reloadConfig,
  loadConfig,
  getLoadedConfigRevision,
} from "../../src/core/config.js";
import { log } from "../../src/core/utils/logger.js";

const CONFIG = path.join(TEST_ROOT, "config.json");

function configWith(adminId: string): object {
  return {
    configVersion: 1,
    token: "test.bot.token.12345",
    clientId: "123456789012345678",
    servers: { s: { apiUrl: "http://127.0.0.1:3030", apiKey: "k" } },
    adminUsers: [adminId],
  };
}

/** The way writeConfig saves: temp file in the same directory, renamed over. */
function saveByRename(cfg: object): void {
  const tmp = `${CONFIG}.tmp`;
  writeFileSync(tmp, JSON.stringify(cfg, null, 2));
  renameSync(tmp, CONFIG);
}

async function waitFor(check: () => boolean, ms = 4000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error("timed out waiting for watcher");
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

afterEach(() => {
  stopWatchingConfig();
});

describe("watchConfig", () => {
  it("sees every save when the file is replaced by rename", async () => {
    writeFileSync(CONFIG, JSON.stringify(configWith("a1")));
    reloadConfig();
    const seen: string[] = [];
    watchConfig((cfg) => seen.push(cfg.adminUsers[0]!), { debounceMs: 30 });

    for (const id of ["b2", "c3", "d4"]) {
      saveByRename(configWith(id));
      await waitFor(() => seen.includes(id));
    }
    expect(seen.at(-1)).toBe("d4");
    expect(loadConfig().adminUsers).toEqual(["d4"]);
  });

  it("coalesces the events of one save into a single reload", async () => {
    writeFileSync(CONFIG, JSON.stringify(configWith("a1")));
    reloadConfig();
    const onChange = vi.fn();
    watchConfig(onChange, { debounceMs: 200 });
    await new Promise((r) => setTimeout(r, 50));

    saveByRename(configWith("x1"));
    saveByRename(configWith("x2"));
    await waitFor(() => onChange.mock.calls.length > 0);
    await new Promise((r) => setTimeout(r, 300));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]![0].adminUsers).toEqual(["x2"]);
  });

  it("ignores other files in the same directory", async () => {
    writeFileSync(CONFIG, JSON.stringify(configWith("a1")));
    reloadConfig();
    const onChange = vi.fn();
    watchConfig(onChange, { debounceMs: 30 });

    writeFileSync(path.join(TEST_ROOT, "unrelated.json"), "{}");
    writeFileSync(`${CONFIG}.bak`, "{}");
    await new Promise((r) => setTimeout(r, 250));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("keeps the old config and keeps watching after a malformed save", async () => {
    writeFileSync(CONFIG, JSON.stringify(configWith("a1")));
    reloadConfig();
    const seen: string[] = [];
    watchConfig((cfg) => seen.push(cfg.adminUsers[0]!), { debounceMs: 30 });

    const errors = vi.mocked(log.error);
    errors.mockClear();
    const tmp = `${CONFIG}.tmp`;
    writeFileSync(tmp, "{ not json");
    renameSync(tmp, CONFIG);
    await waitFor(() => errors.mock.calls.length > 0);
    expect(seen).toEqual([]);

    saveByRename(configWith("ok"));
    await waitFor(() => seen.includes("ok"));
  });

  it("is idempotent", async () => {
    writeFileSync(CONFIG, JSON.stringify(configWith("a1")));
    reloadConfig();
    const first = vi.fn();
    const second = vi.fn();
    watchConfig(first, { debounceMs: 30 });
    watchConfig(second, { debounceMs: 30 });
    saveByRename(configWith("z"));
    await waitFor(() => first.mock.calls.length > 0);
    expect(second).not.toHaveBeenCalled();
  });
});

describe("loaded config revision", () => {
  it("is the sha256 of the file text that was parsed", () => {
    writeFileSync(CONFIG, JSON.stringify(configWith("rev")));
    reloadConfig();
    const rev = getLoadedConfigRevision();
    const expected = createHash("sha256")
      .update(readFileSync(CONFIG, "utf-8"))
      .digest("hex");
    expect(rev?.hash).toBe(expected);
  });

  it("moves when the file is reloaded after an edit", () => {
    writeFileSync(CONFIG, JSON.stringify(configWith("one")));
    reloadConfig();
    const before = getLoadedConfigRevision()!.hash;
    saveByRename(configWith("two"));
    reloadConfig();
    expect(getLoadedConfigRevision()!.hash).not.toBe(before);
  });
});

afterEach(() => {
  rmSync(`${CONFIG}.tmp`, { force: true });
});
