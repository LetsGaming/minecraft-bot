import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SECRET_FILE_MODE,
  existingFileMode,
  tempSiblingPath,
  writeFileAtomicSync,
} from "../../src/core/utils/config/atomicWrite.js";

const posix = process.platform !== "win32";
const modeOf = (p: string) => fs.statSync(p).mode & 0o777;

describe("writeFileAtomicSync", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "atomic-write-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("replaces the file and leaves no temp file behind", () => {
    const target = path.join(dir, "config.json");
    fs.writeFileSync(target, "old");
    writeFileAtomicSync(target, "new");
    expect(fs.readFileSync(target, "utf8")).toBe("new");
    expect(fs.readdirSync(dir)).toEqual(["config.json"]);
  });

  it("uses a different temp path on every call", () => {
    const target = path.join(dir, "config.json");
    expect(tempSiblingPath(target)).not.toBe(tempSiblingPath(target));
    expect(tempSiblingPath(target).startsWith(`${target}.`)).toBe(true);
  });

  it("reports an owner-only mode for a file that does not exist yet", () => {
    expect(existingFileMode(path.join(dir, "missing.json"))).toBe(
      SECRET_FILE_MODE,
    );
  });

  it.skipIf(!posix)("creates a new file owner-only", () => {
    const target = path.join(dir, "config.json");
    writeFileAtomicSync(target, "{}");
    expect(modeOf(target) & 0o077).toBe(0);
  });

  it.skipIf(!posix)("keeps a restrictive mode across a rewrite", () => {
    const target = path.join(dir, "config.json");
    fs.writeFileSync(target, "old", { mode: 0o600 });
    fs.chmodSync(target, 0o600);
    writeFileAtomicSync(target, "new");
    expect(modeOf(target)).toBe(0o600);
  });

  it.skipIf(!posix)("does not widen an existing mode", () => {
    const target = path.join(dir, "config.json");
    fs.writeFileSync(target, "old");
    fs.chmodSync(target, 0o640);
    writeFileAtomicSync(target, "new");
    expect(modeOf(target)).toBe(0o640);
  });
});
