/**
 * Config path resolution — MCBOT_CONFIG_PATH lets a deployment point the
 * active config at a writable, process-owned location (in Docker, the data/
 * volume). This is the mechanism BUG-04's fix relies on, so pin it directly.
 *
 * CONFIG_PATH is a module-level constant, so each case stubs the env and
 * re-imports config.ts fresh.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import path from "path";

vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("config path resolution", () => {
  it("honors MCBOT_CONFIG_PATH when set", async () => {
    vi.stubEnv("MCBOT_CONFIG_PATH", "/app/data/config.json");
    vi.resetModules();
    const { getConfigPath } = await import("../../src/core/config.js");
    expect(getConfigPath()).toBe(path.resolve("/app/data/config.json"));
  });

  it("treats an empty MCBOT_CONFIG_PATH as unset and falls back to <root>/config.json", async () => {
    vi.stubEnv("MCBOT_CONFIG_PATH", "");
    vi.resetModules();
    const { getConfigPath } = await import("../../src/core/config.js");
    expect(path.basename(getConfigPath())).toBe("config.json");
    expect(getConfigPath()).not.toContain("/app/data");
  });
});
