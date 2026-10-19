import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  importCommandModule,
  assertCommandsLoaded,
} from "../../src/bot/utils/commands/loadCommandFiles.js";

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "import-cmd-"));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("importCommandModule", () => {
  it("imports a module from an absolute path", async () => {
    const file = path.join(dir, "abs.mjs");
    writeFileSync(file, "export const answer = 42;\n");
    const mod = (await importCommandModule(file)) as { answer: number };
    expect(path.isAbsolute(file)).toBe(true);
    expect(mod.answer).toBe(42);
  });

  it("resolves a relative path against the working directory", async () => {
    const file = path.join(dir, "rel.mjs");
    writeFileSync(file, "export const name = 'rel';\n");
    const mod = (await importCommandModule(path.relative(process.cwd(), file))) as {
      name: string;
    };
    expect(mod.name).toBe("rel");
  });
});

describe("assertCommandsLoaded", () => {
  it("throws when no slash command loaded", () => {
    expect(() => assertCommandsLoaded(0, "/x/commands")).toThrow(/no slash commands/i);
  });
  it("accepts a non-empty set", () => {
    expect(() => assertCommandsLoaded(3, "/x/commands")).not.toThrow();
  });
});
