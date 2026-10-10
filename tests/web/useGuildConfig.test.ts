import { describe, it, expect, vi, beforeEach } from "vitest";

const toastAdd = vi.hoisted(() => vi.fn());
// primevue is only installed under src/web, so the bare specifier does not resolve from tests/.
vi.mock("../../src/web/node_modules/primevue/usetoast/index.mjs", () => ({
  useToast: () => ({ add: toastAdd }),
}));

const net = vi.hoisted(() => ({ apiGet: vi.fn(), apiSend: vi.fn() }));
vi.mock("../../src/web/frontend/src/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/web/frontend/src/api")>();
  return { ...actual, apiGet: net.apiGet, apiSend: net.apiSend };
});

import { ApiError } from "../../src/web/frontend/src/api.js";
import { useGuildConfig } from "../../src/web/frontend/src/composables/useGuildConfig.js";
import { clearDirtySources } from "../../src/web/frontend/src/composables/useUnsavedGuard.js";

let blocks: Record<string, Record<string, unknown>>;
let hashes: Record<string, string>;
let schemaCalls: number;

beforeEach(() => {
  vi.clearAllMocks();
  clearDirtySources();
  schemaCalls = 0;
  blocks = { A: { language: "en" }, B: { language: "de" } };
  hashes = { A: "ha1", B: "hb1" };
  net.apiGet.mockImplementation(async (path: string) => {
    const m = /^\/api\/guilds\/([^/]+)\/config$/.exec(path);
    if (m) return { hash: hashes[m[1]!], guildConfig: JSON.parse(JSON.stringify(blocks[m[1]!])) };
    if (path === "/api/guilds/config-schema") {
      schemaCalls += 1;
      return { schema: { properties: {} }, definitions: {} };
    }
    throw new Error(`unexpected ${path}`);
  });
});

describe("useGuildConfig", () => {
  it("refuses to save while loading and after a failed load", async () => {
    net.apiGet.mockRejectedValueOnce(new ApiError(500, "down"));
    const g = useGuildConfig();
    const p = g.load("A");
    expect(g.canSave.value).toBe(false);
    await p;
    expect(g.loadError.value).toBe("down");
    expect(g.canSave.value).toBe(false);
    expect(await g.save()).toBe(false);
    expect(net.apiSend).not.toHaveBeenCalled();
  });

  it("re-fetches the schema every time a guild is opened", async () => {
    const g = useGuildConfig();
    await g.load("A");
    await g.load("B");
    expect(schemaCalls).toBe(2);
  });

  it("clears the previous guild's draft while the next one loads", async () => {
    const g = useGuildConfig();
    await g.load("A");
    const next = g.load("B");
    expect(g.ready.value).toBe(false);
    await next;
    expect(g.model.value).toEqual({ language: "de" });
  });

  it("saves with the guild's own hash and only when something changed", async () => {
    net.apiSend.mockResolvedValue({ ok: true, changed: true, warnings: [] });
    const g = useGuildConfig();
    await g.load("A");
    expect(g.canSave.value).toBe(false);
    g.setField("language", "de");
    expect(g.canSave.value).toBe(true);
    expect(g.pendingCount.value).toBe(1);
    hashes.A = "ha2";
    expect(await g.save()).toBe(true);
    expect(net.apiSend).toHaveBeenCalledWith("PUT", "/api/guilds/A/config", {
      baseHash: "ha1",
      guildConfig: { language: "de" },
    });
  });

  it("keeps edits on a conflict and blocks saving until fields are resolved", async () => {
    net.apiSend.mockRejectedValue(new ApiError(409, "changed", "CONFLICT"));
    const g = useGuildConfig();
    await g.load("A");
    g.setField("language", "de");
    blocks.A = { language: "fr" };
    hashes.A = "ha2";
    await g.save();
    expect(g.conflicts.value).toHaveLength(1);
    expect(g.model.value).toEqual({ language: "de" });
    expect(g.canSave.value).toBe(false);

    g.resolveConflict(g.conflicts.value[0]!, "queued");
    expect(g.canSave.value).toBe(true);
  });

  it("maps validation lines for this guild onto the block's own sections", async () => {
    net.apiSend.mockRejectedValue(
      new ApiError(422, "Validation failed", "VALIDATION_FAILED", {
        errors: ["  - guilds.A.chatBridge: needs a server"],
      }),
    );
    const g = useGuildConfig();
    await g.load("A");
    g.setField("language", "de");
    await g.save();
    expect(g.sectionErrors.value).toEqual({ chatBridge: ["guilds.A.chatBridge: needs a server"] });
  });
});
