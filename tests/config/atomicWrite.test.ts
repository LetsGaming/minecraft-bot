import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SECRET_FILE_MODE,
  existingFileMode,
  sweepStaleTemps,
  tempSiblingPath,
  writeFileAtomic,
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

  it.skipIf(!posix)("never carries world permissions over", () => {
    const target = path.join(dir, "config.json");
    fs.writeFileSync(target, "old");
    fs.chmodSync(target, 0o644);
    writeFileAtomicSync(target, "new");
    expect(modeOf(target) & 0o007).toBe(0);
  });

  describe("sweepStaleTemps", () => {
    const stale = "config.json.4242.0123456789ab.tmp";

    it("removes old temp files of this config and nothing else", () => {
      const target = path.join(dir, "config.json");
      fs.writeFileSync(target, "{}");
      fs.writeFileSync(path.join(dir, stale), "secret");
      fs.writeFileSync(path.join(dir, "config.json.bak-v0-20260101T000000Z"), "x");
      fs.writeFileSync(path.join(dir, "other.json.4242.0123456789ab.tmp"), "x");

      sweepStaleTemps(target, Date.now() + 60 * 60_000);

      expect(fs.readdirSync(dir).sort()).toEqual([
        "config.json",
        "config.json.bak-v0-20260101T000000Z",
        "other.json.4242.0123456789ab.tmp",
      ]);
    });

    it("leaves a recent temp file that another writer may still use", () => {
      const target = path.join(dir, "config.json");
      fs.writeFileSync(path.join(dir, stale), "in flight");
      sweepStaleTemps(target);
      expect(fs.existsSync(path.join(dir, stale))).toBe(true);
    });

    it("does not fail when the directory is missing", () => {
      expect(() =>
        sweepStaleTemps(path.join(dir, "nope", "config.json")),
      ).not.toThrow();
    });
  });
});

describe("writeFileAtomic", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "atomic-write-async-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("replaces the file and leaves no temp file behind", async () => {
    const target = path.join(dir, "config.json");
    fs.writeFileSync(target, "old");
    await writeFileAtomic(target, "new");
    expect(fs.readFileSync(target, "utf8")).toBe("new");
    expect(fs.readdirSync(dir)).toEqual(["config.json"]);
  });

  it("creates the file when it does not exist", async () => {
    const target = path.join(dir, "fresh.json");
    await writeFileAtomic(target, "{}");
    expect(fs.readFileSync(target, "utf8")).toBe("{}");
  });

  it("runs the hook after the temp file is written and before the rename", async () => {
    const target = path.join(dir, "config.json");
    fs.writeFileSync(target, "old");
    const seen: { target: string; names: string[] }[] = [];
    await writeFileAtomic(target, "new", async () => {
      seen.push({
        target: fs.readFileSync(target, "utf8"),
        names: fs.readdirSync(dir).sort(),
      });
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.target).toBe("old");
    expect(seen[0]!.names).toHaveLength(2);
    expect(seen[0]!.names[0]).toBe("config.json");
    expect(fs.readFileSync(target, "utf8")).toBe("new");
  });

  it("keeps the original and removes the temp file when the hook fails", async () => {
    const target = path.join(dir, "config.json");
    fs.writeFileSync(target, "old");
    await expect(
      writeFileAtomic(target, "new", () => Promise.reject(new Error("backup failed"))),
    ).rejects.toThrow("backup failed");
    expect(fs.readFileSync(target, "utf8")).toBe("old");
    expect(fs.readdirSync(dir)).toEqual(["config.json"]);
  });

  it.skipIf(!posix)("keeps an existing restrictive mode", async () => {
    const target = path.join(dir, "config.json");
    fs.writeFileSync(target, "old");
    fs.chmodSync(target, 0o600);
    await writeFileAtomic(target, "new");
    expect(modeOf(target)).toBe(0o600);
  });
});
