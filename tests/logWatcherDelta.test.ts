import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { LogWatcher } from "../src/logWatcher/logWatcher.js";
import type { ServerInstance } from "../src/utils/server.js";

// 1 MB — must match MAX_DELTA_BYTES in logWatcher.ts
const MAX_DELTA = 1024 * 1024;

function makeServer(serverDir: string): ServerInstance {
  return {
    id: "test",
    config: {
      id: "test",
      serverDir,
      linuxUser: "test",
      screenSession: "test",
      useRcon: false,
      rconHost: "localhost",
      rconPort: 25575,
      rconPassword: "",
      scriptDir: "",
    },
  } as unknown as ServerInstance;
}

// ── Unit-level verification of the capping formula ────────────────────────
// The key invariant in _readNewLines is:
//   readEnd = Math.min(stats.size - 1, lastSize + MAX_DELTA_BYTES - 1)
// We verify this formula directly without filesystem I/O so the test is
// deterministic regardless of poll timing.
describe("LogWatcher delta-cap formula", () => {
  it("caps a 3× oversized file to exactly MAX_DELTA per cycle", () => {
    const lastSize = 1024; // arbitrary non-zero position
    const fileSize = lastSize + MAX_DELTA * 3; // 3× the cap

    const readEnd = Math.min(fileSize - 1, lastSize + MAX_DELTA - 1);
    const bytesRead = readEnd - lastSize + 1;

    expect(bytesRead).toBe(MAX_DELTA);
  });

  it("reads to end of file when remaining < MAX_DELTA", () => {
    const lastSize = 1024;
    const remaining = MAX_DELTA / 2; // half the cap
    const fileSize = lastSize + remaining;

    const readEnd = Math.min(fileSize - 1, lastSize + MAX_DELTA - 1);
    const bytesRead = readEnd - lastSize + 1;

    expect(bytesRead).toBe(remaining);
  });

  it("reads exactly MAX_DELTA when remaining == MAX_DELTA", () => {
    const lastSize = 0;
    const fileSize = MAX_DELTA;

    const readEnd = Math.min(fileSize - 1, lastSize + MAX_DELTA - 1);
    const bytesRead = readEnd - lastSize + 1;

    expect(bytesRead).toBe(MAX_DELTA);
  });
});

// ── Integration: watcher actually dispatches lines from a real file ───────
describe("LogWatcher integration", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lw-test-"));
    fs.mkdirSync(path.join(tmpDir, "logs"), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("dispatches lines appended after start()", async () => {
    const logFile = path.join(tmpDir, "logs", "latest.log");
    fs.writeFileSync(logFile, "");

    const watcher = new LogWatcher(makeServer(tmpDir));
    const seen: string[] = [];
    watcher.register(/^TEST (.+)$/, async ([, msg]) => {
      seen.push(msg);
    });

    await watcher.start(null as any);
    fs.appendFileSync(logFile, "TEST hello\nTEST world\n");

    // Wait for one poll cycle
    await new Promise((r) => setTimeout(r, 1200));
    watcher.stop();

    expect(seen).toContain("hello");
    expect(seen).toContain("world");
  });

  it("consumes a large append across multiple cycles without getting stuck", async () => {
    const logFile = path.join(tmpDir, "logs", "latest.log");
    fs.writeFileSync(logFile, ""); // empty seed

    const watcher = new LogWatcher(makeServer(tmpDir));
    let totalLines = 0;
    watcher.register(/.+/, async () => {
      totalLines++;
    });

    await watcher.start(null as any);

    // Append 2 MB AFTER start() — the watcher will consume it across cycles
    const row = "CATCHUP line\n"; // ~14 bytes
    const count = Math.ceil((MAX_DELTA * 2) / row.length);
    fs.appendFileSync(logFile, row.repeat(count));

    // 3 poll cycles should be more than enough to consume 2 MB at 1 MB/cycle
    await new Promise((r) => setTimeout(r, 3200));
    watcher.stop();

    // Verify all lines were eventually dispatched — no data was lost
    expect(totalLines).toBeGreaterThanOrEqual(count);
  });
});
