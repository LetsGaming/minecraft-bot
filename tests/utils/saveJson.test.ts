import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { saveJson, loadJson } from "../../src/core/utils/jsonStore.js";
import { promises as fs } from "fs";
import path from "path";
import os from "os";

describe("saveJson", () => {
  let tmpFile: string;

  beforeEach(async () => {
    tmpFile = path.join(os.tmpdir(), `minecraft-bot-test-${Date.now()}.json`);
    await saveJson(tmpFile, {});
  });

  afterEach(async () => {
    await fs.rm(tmpFile, { force: true });
    await fs.rm(`${tmpFile}.bak`, { force: true });
    await fs.rm(`${tmpFile}.tmp`, { force: true });
    await fs.rm(`${tmpFile}.bak.tmp`, { force: true });
  });

  it("writes and reads back a simple object", async () => {
    await saveJson(tmpFile, { hello: "world" });
    const result = await loadJson(tmpFile);
    expect(result).toMatchObject({ hello: "world" });
  });

  it("writes valid JSON (not corrupted) under concurrent writes", async () => {
    // Ten concurrent writes — without the mutex the file would be corrupted.
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        saveJson(tmpFile, { [`key${i}`]: i }),
      ),
    );
    // The file must still be parseable valid JSON.
    const raw = await fs.readFile(tmpFile, "utf-8");
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it("final state after sequential writes is the last written value", async () => {
    await saveJson(tmpFile, { value: 1 });
    await saveJson(tmpFile, { value: 2 });
    await saveJson(tmpFile, { value: 3 });
    const result = (await loadJson(tmpFile)) as { value: number };
    expect(result.value).toBe(3);
  });

  it("returns cached value when file has not changed", async () => {
    await saveJson(tmpFile, { cached: true });
    const first = await loadJson(tmpFile);
    const second = await loadJson(tmpFile);
    // Both calls must return equivalent data (cache hit on second call).
    expect(first).toEqual(second);
  });
});

// ── Atomic writes + corruption recovery ────────────────────────────────────

describe("saveJson atomicity and backups", () => {
  let tmpFile: string;

  beforeEach(() => {
    tmpFile = path.join(
      os.tmpdir(),
      `minecraft-bot-atomic-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
    );
  });

  afterEach(async () => {
    for (const suffix of ["", ".bak", ".tmp", ".bak.tmp"]) {
      await fs.rm(`${tmpFile}${suffix}`, { force: true });
    }
  });

  it("writes a .bak last-known-good copy on each successful save", async () => {
    await saveJson(tmpFile, { generation: 1 });
    const bak = JSON.parse(await fs.readFile(`${tmpFile}.bak`, "utf-8")) as {
      generation: number;
    };
    expect(bak.generation).toBe(1);

    await saveJson(tmpFile, { generation: 2 });
    const bak2 = JSON.parse(await fs.readFile(`${tmpFile}.bak`, "utf-8")) as {
      generation: number;
    };
    expect(bak2.generation).toBe(2);
  });

  it("leaves no .tmp staging files behind after a successful save", async () => {
    await saveJson(tmpFile, { hello: "world" });
    await expect(fs.stat(`${tmpFile}.tmp`)).rejects.toThrow();
    await expect(fs.stat(`${tmpFile}.bak.tmp`)).rejects.toThrow();
  });

  it("a stale .tmp from an interrupted write never shadows the real file", async () => {
    // Simulate a crash mid-write: a partial .tmp exists but the rename
    // never happened. The real file must be untouched and readable.
    await saveJson(tmpFile, { intact: true });
    await fs.writeFile(`${tmpFile}.tmp`, '{"partial": tru'); // truncated
    const result = (await loadJson(tmpFile)) as { intact: boolean };
    expect(result.intact).toBe(true);
  });
});

describe("loadJson corruption handling", () => {
  let tmpFile: string;

  beforeEach(() => {
    tmpFile = path.join(
      os.tmpdir(),
      `minecraft-bot-corrupt-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
    );
  });

  afterEach(async () => {
    for (const suffix of ["", ".bak", ".tmp", ".bak.tmp"]) {
      await fs.rm(`${tmpFile}${suffix}`, { force: true });
    }
  });

  it("still returns {} for a file that simply does not exist (ENOENT)", async () => {
    const result = await loadJson(`${tmpFile}.does-not-exist`);
    expect(result).toEqual({});
  });

  it("recovers from the .bak copy when the main file is corrupt", async () => {
    await saveJson(tmpFile, { links: { user1: "Steve", user2: "Alex" } });
    // Simulate a truncated file left by a crash / power loss.
    await fs.writeFile(tmpFile, '{"links": {"user1": "Ste');

    const recovered = (await loadJson(tmpFile)) as {
      links: Record<string, string>;
    };
    expect(recovered.links).toEqual({ user1: "Steve", user2: "Alex" });
  });

  it("throws (instead of returning {}) when both file and backup are unusable", async () => {
    await fs.writeFile(tmpFile, "not json at all {{{");
    // No .bak exists → the old behaviour silently returned {} and the next
    // save would have wiped the store. The new behaviour fails loudly.
    await expect(loadJson(tmpFile)).rejects.toThrow(/corrupt|unreadable/i);
  });

  it("a save after .bak recovery repairs the main file", async () => {
    await saveJson(tmpFile, { value: "good" });
    await fs.writeFile(tmpFile, "garbage");
    const recovered = (await loadJson(tmpFile)) as { value: string };
    expect(recovered.value).toBe("good");

    // Simulates the normal flow: caller loads (recovered) state, mutates,
    // saves — the corrupt main file is replaced atomically.
    await saveJson(tmpFile, { ...recovered, repaired: true });
    const raw = await fs.readFile(tmpFile, "utf-8");
    expect(JSON.parse(raw)).toEqual({ value: "good", repaired: true });
  });
});
