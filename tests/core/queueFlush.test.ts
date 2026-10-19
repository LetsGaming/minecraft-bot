import { describe, it, expect, vi, beforeEach } from "vitest";

const queued = vi.hoisted(() => ({ edits: [] as unknown[] }));
const access = vi.hoisted(() => ({
  readConfigFile: vi.fn(),
  writeConfigFile: vi.fn(),
}));
const audit = vi.hoisted(() => ({ recordAdminAction: vi.fn() }));

vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../src/core/utils/server/server.js", () => ({
  getServerInstance: () => ({ config: { id: "smp" } }),
}));
vi.mock("../../src/core/utils/server/serverAccess.js", () => access);
vi.mock("../../src/core/utils/stores/adminAudit.js", () => audit);
vi.mock("../../src/core/utils/wrapper/lastKnown.js", () => ({ forget: vi.fn() }));
vi.mock("../../src/core/utils/stores/queuedEdits.js", async (orig) => {
  const real = await orig<typeof import("../../src/core/utils/stores/queuedEdits.js")>();
  return {
    ...real,
    pendingForServer: () => queued.edits,
    dropEdits: vi.fn(),
  };
});

import {
  flushQueuedEdits,
  previewQueuedEdits,
} from "../../src/core/utils/wrapper/queueFlush.js";

function edit(fileId: string, base: number, next: number) {
  return {
    id: 1,
    serverId: "smp",
    fileId,
    relPath: "a.properties",
    keyPath: ["max-players"],
    newValue: next,
    baseValue: base,
    queuedAt: 0,
    byId: null,
    byTag: "t",
  };
}

const file = (editable: boolean, text: string) => ({
  file: { relPath: "a.properties", editable },
  text,
  etag: "e1",
});

beforeEach(() => {
  vi.clearAllMocks();
  queued.edits = [edit("f1", 20, 30)];
  access.writeConfigFile.mockResolvedValue({ ok: true });
});

describe("queued edit flush and preview share one gate", () => {
  it("both skip a file that became read-only", async () => {
    access.readConfigFile.mockResolvedValue(file(false, "max-players=20\n"));
    expect(await previewQueuedEdits("smp")).toMatchObject({ ready: 0, readOnly: 1 });
    const result = await flushQueuedEdits("smp", { tag: "t", uid: "u" });
    expect(result).toMatchObject({ applied: 0, skipped: 1 });
    expect(access.writeConfigFile).not.toHaveBeenCalled();
  });

  it("both count a clean edit as ready", async () => {
    access.readConfigFile.mockResolvedValue(file(true, "max-players=20\n"));
    expect(await previewQueuedEdits("smp")).toMatchObject({ ready: 1, readOnly: 0 });
    const result = await flushQueuedEdits("smp", { tag: "t", uid: "u" });
    expect(result.applied).toBe(1);
    expect(access.writeConfigFile).toHaveBeenCalledOnce();
  });

  it("reports an unreadable file without throwing", async () => {
    access.readConfigFile.mockRejectedValue(new Error("down"));
    expect(await previewQueuedEdits("smp")).toMatchObject({ unreadable: 1 });
  });

  it("keeps flushing the remaining files when the audit write throws", async () => {
    queued.edits = [edit("f1", 20, 30), edit("f2", 20, 40)];
    access.readConfigFile.mockResolvedValue(file(true, "max-players=20\n"));
    audit.recordAdminAction.mockRejectedValue(new Error("db locked"));
    const result = await flushQueuedEdits("smp", { tag: "t", uid: "u" });
    expect(result.applied).toBe(2);
    expect(access.writeConfigFile).toHaveBeenCalledTimes(2);
  });
});
