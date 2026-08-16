import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  getCommandFiles,
  categoryOf,
} from "../../src/bot/utils/commands/loadCommandFiles.js";

/**
 * The shared command-file loader. It replaced two drifted copies — one
 * excluded middleware.js, the other did not — so the behaviour that matters
 * most to pin is that middleware.js is now excluded everywhere, and that
 * nested command files are found and categorised by their first folder.
 */

let root: string;

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), "cmds-"));
  mkdirSync(path.join(root, "connection", "daily"), { recursive: true });
  mkdirSync(path.join(root, "server"), { recursive: true });
  writeFileSync(path.join(root, "connection", "daily", "daily.js"), "");
  writeFileSync(path.join(root, "connection", "link.js"), "");
  writeFileSync(path.join(root, "server", "tps.js"), "");
  // A loose command directly in the root — no category.
  writeFileSync(path.join(root, "verify.js"), "");
  // The wrapper, which is not a command and must never be loaded.
  writeFileSync(path.join(root, "middleware.js"), "");
  // Non-JS files (source maps, declarations) must be ignored.
  writeFileSync(path.join(root, "server", "tps.js.map"), "");
  writeFileSync(path.join(root, "server", "tps.d.ts"), "");
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("getCommandFiles", () => {
  it("finds .js command modules recursively", () => {
    const found = getCommandFiles(root).map((f) => path.relative(root, f));
    expect(found).toContain(path.join("connection", "daily", "daily.js"));
    expect(found).toContain(path.join("connection", "link.js"));
    expect(found).toContain(path.join("server", "tps.js"));
    expect(found).toContain("verify.js");
  });

  it("excludes middleware.js everywhere", () => {
    // The whole reason the two copies were a liability: one skipped this file
    // and one did not. Now neither loads it.
    const found = getCommandFiles(root).map((f) => path.basename(f));
    expect(found).not.toContain("middleware.js");
  });

  it("ignores non-JS files", () => {
    const found = getCommandFiles(root).map((f) => path.basename(f));
    expect(found).not.toContain("tps.js.map");
    expect(found).not.toContain("tps.d.ts");
  });
});

describe("categoryOf", () => {
  it("takes the first folder as the category", () => {
    expect(categoryOf(root, path.join(root, "connection", "daily", "daily.js"))).toBe("connection");
    expect(categoryOf(root, path.join(root, "server", "tps.js"))).toBe("server");
  });

  it("returns empty for a file directly in the root", () => {
    expect(categoryOf(root, path.join(root, "verify.js"))).toBe("");
  });
});
