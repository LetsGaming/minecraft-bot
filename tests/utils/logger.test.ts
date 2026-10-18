import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let dir: string;
let lines: string[];

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcbot-logger-"));
  lines = [];
  vi.spyOn(process, "cwd").mockReturnValue(dir);
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    lines.push(String(chunk));
    return true;
  });
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("logger", () => {
  it("does not create the logs directory until the first line is logged", async () => {
    const { log } = await import("../../src/core/utils/logger.js");
    expect(fs.existsSync(path.join(dir, "logs"))).toBe(false);
    log.info("t", "hello");
    expect(fs.existsSync(path.join(dir, "logs"))).toBe(true);
  });

  it("prints an Error with its message and cause", async () => {
    const { log } = await import("../../src/core/utils/logger.js");
    log.error("t", new TypeError("fetch failed", { cause: new Error("ECONNREFUSED") }));
    expect(lines.join("")).toContain("fetch failed (cause: ECONNREFUSED)");
  });

  it("does not throw on a circular object", async () => {
    const { log } = await import("../../src/core/utils/logger.js");
    const loop: Record<string, unknown> = { a: 1 };
    loop["self"] = loop;
    expect(() => log.info("t", loop)).not.toThrow();
    expect(lines.join("")).toContain("[Circular]");
  });
});
