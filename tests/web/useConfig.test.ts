import { describe, it, expect, vi, beforeEach } from "vitest";

const toastAdd = vi.hoisted(() => vi.fn());
// primevue is only installed under src/web, so the bare specifier does not resolve from tests/.
vi.mock("../../src/web/node_modules/primevue/usetoast/index.mjs", () => ({ useToast: () => ({ add: toastAdd }) }));

const net = vi.hoisted(() => ({ apiGet: vi.fn(), apiSend: vi.fn() }));
vi.mock("../../src/web/frontend/src/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/web/frontend/src/api")>();
  return { ...actual, apiGet: net.apiGet, apiSend: net.apiSend };
});

import { ApiError } from "../../src/web/frontend/src/api.js";
import { useConfig } from "../../src/web/frontend/src/composables/useConfig.js";
import { clearDirtySources } from "../../src/web/frontend/src/composables/useUnsavedGuard.js";
import { groupErrors, parseFieldError } from "../../src/web/frontend/src/utils/fieldErrors.js";

let serverConfig: Record<string, unknown>;
let hash: number;

function route(): void {
  net.apiGet.mockImplementation(async (path: string) => {
    if (path === "/api/config") return { hash: `h${hash}`, config: JSON.parse(JSON.stringify(serverConfig)) };
    if (path === "/api/config/schema") return { properties: {}, definitions: {} };
    throw new Error(`unexpected ${path}`);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  clearDirtySources();
  serverConfig = { language: "en", tpsWarningThreshold: 15, guilds: { g1: { language: "en" } } };
  hash = 1;
  route();
});

describe("useConfig", () => {
  it("is loading before the fetch returns and ready after", async () => {
    const c = useConfig();
    const p = c.load();
    expect(c.loading.value).toBe(true);
    expect(c.ready.value).toBe(false);
    await p;
    expect(c.loading.value).toBe(false);
    expect(c.ready.value).toBe(true);
  });

  it("does not claim raw mode on a load failure, and never PUTs null", async () => {
    net.apiGet.mockRejectedValueOnce(new ApiError(500, "boom"));
    const c = useConfig();
    await c.load();
    expect(c.loadError.value).toBe("boom");
    expect(c.rawMode.value).toBe(false);
    expect(c.canSave.value).toBe(false);
    expect(await c.save()).toBe(false);
    expect(net.apiSend).not.toHaveBeenCalled();

    await c.load();
    expect(c.ready.value).toBe(true);
    expect(c.loadError.value).toBe("");
  });

  it("keeps Save disabled until something changes and counts pending sections", async () => {
    const c = useConfig();
    await c.load();
    expect(c.canSave.value).toBe(false);
    c.setTop("language", "de");
    expect(c.canSave.value).toBe(true);
    expect(c.pendingCount.value).toBe(1);
    expect(c.isDirty("language")).toBe(true);
    c.setTop("language", "en");
    expect(c.canSave.value).toBe(false);
  });

  it("saves with the load-time hash and does not toast for an unchanged form", async () => {
    net.apiSend.mockResolvedValue({ ok: true, changed: true, warnings: [] });
    const c = useConfig();
    await c.load();
    expect(await c.save()).toBe(false);
    expect(toastAdd).not.toHaveBeenCalled();

    c.setTop("language", "de");
    hash = 2;
    expect(await c.save()).toBe(true);
    expect(net.apiSend).toHaveBeenCalledWith("PUT", "/api/config", {
      baseHash: "h1",
      config: expect.objectContaining({ language: "de" }),
    });
    expect(toastAdd).toHaveBeenCalledTimes(1);
  });

  it("toggling raw mode does not flip back on a parse error and keeps the draft", async () => {
    const c = useConfig();
    await c.load();
    c.setRawMode(true);
    c.setRawText("{ nope");
    expect(c.rawError.value).not.toBe("");
    expect(c.canSave.value).toBe(false);
    c.setRawMode(false);
    expect(c.rawMode.value).toBe(true);

    c.setRawText(JSON.stringify({ language: "de" }));
    expect(c.rawError.value).toBe("");
    expect(c.dirty.value).toBe(true);
    c.setRawMode(false);
    expect(c.rawMode.value).toBe(false);
  });

  it("falls back to raw mode only when the schema is missing", async () => {
    net.apiGet.mockImplementation(async (path: string) => {
      if (path === "/api/config") return { hash: "h1", config: {} };
      throw new ApiError(404, "no schema");
    });
    const c = useConfig();
    await c.load();
    expect(c.schemaFailed.value).toBe(true);
    expect(c.rawMode.value).toBe(true);
    expect(c.ready.value).toBe(true);
  });

  it("maps validation errors to their section and keeps the rest in the banner", async () => {
    net.apiSend.mockRejectedValue(
      new ApiError(422, "Validation failed", "VALIDATION_FAILED", {
        errors: [
          "  - guilds.g1.chatBridge: needs a server",
          "  - tpsWarningThreshold: must be positive",
          "something without a path",
        ],
      }),
    );
    const c = useConfig();
    await c.load();
    c.setTop("tpsWarningThreshold", -1);
    await c.save();
    expect(c.sectionErrors.value).toEqual({
      guilds: ["guilds.g1.chatBridge: needs a server"],
      tpsWarningThreshold: ["tpsWarningThreshold: must be positive"],
    });
    expect(c.errors.value).toContain("something without a path");
    expect(c.dirty.value).toBe(true);
  });

  it("keeps the user's edits on a 409 instead of overwriting them", async () => {
    net.apiSend.mockRejectedValue(new ApiError(409, "changed", "CONFLICT"));
    const c = useConfig();
    await c.load();
    c.setTop("language", "de");
    serverConfig = { ...serverConfig, tpsWarningThreshold: 20 };
    hash = 2;
    await c.save();
    expect(c.model.value).toMatchObject({ language: "de", tpsWarningThreshold: 20 });
    expect(c.isDirty("language")).toBe(true);
    expect(c.errors.value[0]).toMatch(/changed since you loaded/i);
  });
});

describe("field error parsing", () => {
  it("parses path lines, with optional parenthetical context", () => {
    expect(parseFieldError("  - servers.smp.apiUrl: bad")).toEqual({
      path: ["servers", "smp", "apiUrl"],
      message: "bad",
    });
    expect(parseFieldError("  - guilds.1.chatBridge (channel 5): conflict")?.path).toEqual([
      "guilds", "1", "chatBridge",
    ]);
    expect(parseFieldError("just words")).toBeNull();
  });

  it("groups by a caller-supplied section", () => {
    const out = groupErrors(["  - a.b: x", "plain"], (p) => p[0] ?? null);
    expect(out.bySection).toEqual({ a: ["a.b: x"] });
    expect(out.general).toEqual(["plain"]);
  });
});
