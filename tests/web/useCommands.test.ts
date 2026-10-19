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
import { useCommands } from "../../src/web/frontend/src/composables/useCommands.js";
import { clearDirtySources } from "../../src/web/frontend/src/composables/useUnsavedGuard.js";

let fileHash: string;
let globalOverrides: Record<string, unknown>;

function commandsPayload() {
  return {
    hash: fileHash,
    manifest: { slash: [{ name: "ping", description: "" }, { name: "stats", description: "" }], ingame: [] },
    usage: { windowDays: 30, byCommand: {} },
    scopes: { guildIds: ["g1"], serverIds: [] },
    commandOptions: {},
    overrides: { global: JSON.parse(JSON.stringify(globalOverrides)), guilds: { g1: {} }, servers: {} },
    effective: {},
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  clearDirtySources();
  fileHash = "h1";
  globalOverrides = {};
  net.apiGet.mockImplementation(async (path: string) => {
    if (path === "/api/commands") return commandsPayload();
    if (path === "/api/config") {
      return { hash: fileHash, config: { commands: globalOverrides, guilds: { g1: {} }, servers: {} } };
    }
    throw new Error(`unexpected ${path}`);
  });
});

describe("useCommands", () => {
  it("tracks pending changes per command and per scope", async () => {
    const c = useCommands();
    await c.load();
    expect(c.dirty.value).toBe(false);
    c.setField("ping", "enabled", "false");
    c.scope.value = "guild:g1";
    c.setField("stats", "adminOnly", "true");
    expect(c.pendingCount()).toBe(2);
    c.setField("stats", "adminOnly", "inherit");
    expect(c.pendingCount()).toBe(1);
    c.discard();
    expect(c.dirty.value).toBe(false);
  });

  it("reading an unset scope creates nothing, so the page is not dirty after a look", async () => {
    const c = useCommands();
    await c.load();
    c.scope.value = "guild:unknown";
    expect(c.overriddenCount()).toBe(0);
    expect(c.fieldValue("ping", "enabled")).toBe("inherit");
    expect(c.isOverridden("ping")).toBe(false);
    expect(c.dirty.value).toBe(false);
    c.setField("ping", "enabled", "inherit");
    expect(c.dirty.value).toBe(false);
  });

  it("undoing the only edit of a new scope leaves nothing to save", async () => {
    const c = useCommands();
    await c.load();
    c.scope.value = "server:smp";
    c.setField("ping", "enabled", "false");
    expect(c.dirty.value).toBe(true);
    c.setField("ping", "enabled", "inherit");
    expect(c.dirty.value).toBe(false);
  });

  it("warns instead of reporting success when a scope has no entry in the configuration", async () => {
    net.apiSend.mockResolvedValue({ ok: true, changed: true, warnings: [] });
    const c = useCommands();
    await c.load();
    c.scope.value = "server:smp";
    c.setField("ping", "enabled", "false");
    expect(await c.save()).toBe(true);
    expect(toastAdd).toHaveBeenCalledTimes(1);
    expect(toastAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: "warn" }));
  });

  it("saves with the hash from the load, not one fetched at save time", async () => {
    net.apiSend.mockResolvedValue({ ok: true, changed: true, warnings: [] });
    const c = useCommands();
    await c.load();
    c.setField("ping", "enabled", "false");
    fileHash = "h2";
    await c.save();
    expect(net.apiSend).toHaveBeenCalledWith("PUT", "/api/config", {
      baseHash: "h1",
      config: expect.objectContaining({ commands: { ping: { enabled: false } } }),
    });
  });

  it("can now hit a 409, keeps the edits and shows the failure persistently", async () => {
    net.apiSend.mockRejectedValue(new ApiError(409, "changed", "CONFLICT"));
    const c = useCommands();
    await c.load();
    c.setField("ping", "enabled", "false");
    fileHash = "h2";
    globalOverrides = { stats: { enabled: false } };
    expect(await c.save()).toBe(false);
    expect(c.saveFailure.value[0]).toMatch(/changed since you loaded/i);
    expect(c.overrides.value.global).toEqual({
      ping: { enabled: false },
      stats: { enabled: false },
    });
    expect(c.pendingCount()).toBe(1);
    expect(toastAdd).not.toHaveBeenCalled();
  });

  it("offers the choice for a command both sides edited", async () => {
    net.apiSend.mockRejectedValue(new ApiError(409, "changed", "CONFLICT"));
    const c = useCommands();
    await c.load();
    c.setField("ping", "enabled", "false");
    fileHash = "h2";
    globalOverrides = { ping: { enabled: true, adminOnly: true } };
    await c.save();
    expect(c.conflicts.value).toHaveLength(1);
    expect(c.conflicts.value[0]!.keyPath).toEqual(["global", "ping"]);
    c.resolveConflict(c.conflicts.value[0]!, "current");
    expect(c.overrides.value.global.ping).toEqual({ enabled: true, adminOnly: true });
  });

  it("keeps a load failure retryable", async () => {
    net.apiGet.mockRejectedValueOnce(new ApiError(503, "Command manifest not written yet"));
    const c = useCommands();
    await c.load();
    expect(c.loadError.value).toMatch(/manifest/);
    expect(c.ready.value).toBe(false);
    expect(c.manifestMissing.value).toBe(true);
    await c.load();
    expect(c.loadError.value).toBe("");
    expect(c.ready.value).toBe(true);
    expect(c.manifestMissing.value).toBe(false);
  });

  it("tells a missing manifest apart from any other load failure", async () => {
    net.apiGet.mockRejectedValueOnce(new ApiError(500, "Internal server error"));
    const c = useCommands();
    await c.load();
    expect(c.loadError.value).not.toBe("");
    expect(c.manifestMissing.value).toBe(false);
  });

  it("lists validation failures from the backend", async () => {
    net.apiSend.mockRejectedValue(
      new ApiError(422, "Validation failed", "VALIDATION_FAILED", { errors: ["  - commands.ping: bad"] }),
    );
    const c = useCommands();
    await c.load();
    c.setField("ping", "enabled", "false");
    await c.save();
    expect(c.saveFailure.value).toContain("commands.ping: bad");
  });
});
