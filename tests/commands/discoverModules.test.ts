import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { log } from "../../src/core/utils/logger.js";
import { discoverModules, manifestOf } from "../../src/bot/utils/commands/loadCommandFiles.js";

let root: string;

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), "discover-"));
  mkdirSync(path.join(root, "info"), { recursive: true });
  mkdirSync(path.join(root, "stale"), { recursive: true });
  writeFileSync(path.join(root, "info", "status.js"), 'export const name = "status"; export const text = "Server status";\n');
  writeFileSync(path.join(root, "info", "helper.js"), "export const unrelated = 1;\n");
  writeFileSync(path.join(root, "loose.js"), 'export const name = "loose"; export const text = "";\n');
  writeFileSync(path.join(root, "stale", "status.js"), 'export const name = "status"; export const text = "Old copy";\n');
  writeFileSync(path.join(root, "broken.js"), 'throw new Error("syntax of a bad day");\n');
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

const identify = (mod: unknown) => {
  const { name, text } = mod as { name?: string; text?: string };
  return name ? { name, description: text ?? "", value: name } : null;
};

describe("discoverModules", () => {
  it("keeps the modules identify accepts, with their folder as category", async () => {
    const found = await discoverModules(root, "slash", identify);
    const byName = Object.fromEntries(found.map((m) => [m.name, m]));
    expect(Object.keys(byName).sort()).toEqual(["loose", "status"]);
    expect(byName["loose"]!.category).toBe("");
    expect(["info", "stale"]).toContain(byName["status"]!.category);
  });

  it("refuses the second module claiming a name and says so", async () => {
    const found = await discoverModules(root, "slash", identify);
    expect(found.filter((m) => m.name === "status")).toHaveLength(1);
    expect(log.warn).toHaveBeenCalledWith("commands", expect.stringContaining("Ignoring duplicate slash command status"));
  });

  it("logs a module that fails to import and carries on", async () => {
    const found = await discoverModules(root, "in-game", identify);
    expect(log.error).toHaveBeenCalledWith("commands", expect.stringContaining("broken.js"));
    expect(found.length).toBeGreaterThan(0);
  });

  it("builds the manifest from what was found", async () => {
    const found = await discoverModules(root, "slash", identify);
    const manifest = manifestOf(found);
    expect(manifest).toHaveLength(found.length);
    expect(manifest.find((m) => m.name === "loose")).toEqual({
      name: "loose",
      description: "",
      category: "",
    });
  });
});
