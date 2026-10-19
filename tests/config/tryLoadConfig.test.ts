import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { writeFileSync, mkdirSync, copyFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = vi.hoisted(
  () =>
    `${process.env["TEMP"] ?? process.env["TMPDIR"] ?? "/tmp"}/mcbot-tryload-${process.pid}-${Math.random().toString(36).slice(2)}`,
);

vi.mock("../../src/core/utils/paths.js", () => ({
  getRootDir: () => root,
}));

const warn = vi.hoisted(() => vi.fn());
vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn, error: vi.fn(), debug: vi.fn() },
}));

const schemaPath = fileURLToPath(new URL("../../config.schema.json", import.meta.url));
const good = {
  token: "test.bot.token.12345",
  clientId: "123456789012345678",
  servers: { s: { apiUrl: "http://127.0.0.1:3030", apiKey: "k" } },
};

function writeConfig(text: string): void {
  writeFileSync(join(root, "config.json"), text);
}

/** A fresh config module, so the cached config of an earlier test cannot answer. */
async function freshConfigModule(): Promise<typeof import("../../src/core/config.js")> {
  vi.resetModules();
  return import("../../src/core/config.js");
}

/** A fresh config access module on top of a fresh config module. */
async function freshAccessModule(): Promise<typeof import("../../src/core/utils/config/configAccess.js")> {
  vi.resetModules();
  return import("../../src/core/utils/config/configAccess.js");
}

beforeEach(() => {
  mkdirSync(root, { recursive: true });
  copyFileSync(schemaPath, join(root, "config.schema.json"));
  warn.mockClear();
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("tryLoadConfig", () => {
  it("returns the config on success", async () => {
    writeConfig(JSON.stringify(good));
    const { tryLoadConfig } = await freshAccessModule();
    const r = tryLoadConfig({ onError: "closed" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.config.clientId).toBe(good.clientId);
  });

  it("states the fail direction the caller asked for", async () => {
    writeConfig("{ not json");
    const { tryLoadConfig } = await freshAccessModule();
    expect(tryLoadConfig({ onError: "open" })).toMatchObject({ ok: false, failOpen: true });
    expect(tryLoadConfig({ onError: "closed" })).toMatchObject({ ok: false, failOpen: false });
  });

  it("logs a repeating failure once and a different failure again", async () => {
    writeConfig("{ not json");
    const { tryLoadConfig } = await freshAccessModule();
    tryLoadConfig({ onError: "open" });
    tryLoadConfig({ onError: "open" });
    const configWarnings = (): number =>
      warn.mock.calls.filter(([tag, msg]) => tag === "config" && String(msg).includes("could not be loaded")).length;
    expect(configWarnings()).toBe(1);

    writeConfig(JSON.stringify({ token: 5 }));
    tryLoadConfig({ onError: "open" });
    expect(configWarnings()).toBe(2);
  });
});

describe("apiKeyEnvVar", () => {
  it("upper-cases the id and replaces unsafe characters", async () => {
    const { apiKeyEnvVar } = await freshConfigModule();
    expect(apiKeyEnvVar("smp-1")).toBe("API_KEY_SMP_1");
    expect(apiKeyEnvVar("a.b c")).toBe("API_KEY_A_B_C");
  });
});
