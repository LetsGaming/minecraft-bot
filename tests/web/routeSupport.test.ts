/** Shared route scaffolding: query parsing, wrapper-call guard, 423 mapping, capability probes, cache busting. */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { logError, recordAdminActionMock } = vi.hoisted(() => ({
  logError: vi.fn(),
  recordAdminActionMock: vi.fn(),
}));

vi.mock("../../src/core/utils/logger.js", () => ({
  log: { error: logError, warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../src/core/utils/stores/adminAudit.js", () => ({
  recordAdminAction: recordAdminActionMock,
}));
vi.mock("../../src/core/utils/server/server.js", () => ({
  getServerInstance: vi.fn((id: string) => (id === "smp" ? { id, config: { id } } : null)),
}));

import { clampIntParam, flagParam, intParam } from "../../src/web/backend/routes/query.js";
import {
  OPERATION_FAILED,
  auditAction,
  requireFileId,
  requireServer,
  wrapperCall,
} from "../../src/web/backend/routes/support.js";
import { busyConflict, busyKind } from "../../src/web/backend/routes/busy.js";
import { capabilityProbe } from "../../src/web/backend/routes/capabilityProbe.js";
import { bustConfigFile, bustMods } from "../../src/web/backend/routes/cacheKeys.js";
import { scriptResultBody } from "../../src/web/backend/routes/scriptFailure.js";
import { BadGateway, Conflict, HttpError, NotFound, BadRequest } from "../../src/web/backend/errors.js";
import { ApiError } from "../../src/core/utils/server/access/apiClient.js";
import { cached, invalidateWhere } from "../../src/core/utils/cache.js";
import { clearLastKnown, readThrough, recall } from "../../src/core/utils/wrapper/lastKnown.js";

beforeEach(() => {
  vi.clearAllMocks();
  invalidateWhere(() => true);
  clearLastKnown();
});

describe("query parsing", () => {
  const range = { def: 50, min: 1, max: 200 };

  it("clamps into the range and falls back to the default", () => {
    expect(clampIntParam(undefined, range)).toBe(50);
    expect(clampIntParam("abc", range)).toBe(50);
    expect(clampIntParam("0", range)).toBe(1);
    expect(clampIntParam("9999", range)).toBe(200);
    expect(clampIntParam("75", range)).toBe(75);
  });

  it("tells an absent integer from a present one", () => {
    expect(intParam(undefined)).toBeNull();
    expect(intParam("x")).toBeNull();
    expect(intParam("24")).toBe(24);
  });

  it("reads 1/true and 0/false uniformly, anything else is the default", () => {
    for (const on of ["1", "true"]) expect(flagParam(on)).toBe(true);
    for (const off of ["0", "false"]) expect(flagParam(off, true)).toBe(false);
    expect(flagParam(undefined)).toBe(false);
    expect(flagParam(undefined, true)).toBe(true);
    expect(flagParam("yes", true)).toBe(true);
  });
});

describe("requireServer / requireFileId", () => {
  it("throws the shared 404 for an unknown server", () => {
    expect(() => requireServer("nope")).toThrow(NotFound);
    expect(() => requireServer("nope")).toThrow('No server named "nope" is configured.');
    expect(requireServer("smp").id).toBe("smp");
  });

  it("refuses an id that is not 22 base64url characters", () => {
    expect(() => requireFileId("short", "backup")).toThrow(BadRequest);
    expect(() => requireFileId("short", "backup")).toThrow("Invalid backup id.");
    expect(requireFileId("AbCdEfGhIjKlMnOpQrStUv", "config")).toBe("AbCdEfGhIjKlMnOpQrStUv");
  });
});

describe("wrapperCall", () => {
  it("returns the result", async () => {
    await expect(wrapperCall("Thing", {}, async () => 7)).resolves.toBe(7);
  });

  it("passes a typed failure through untouched", async () => {
    const err = new Conflict("busy");
    await expect(wrapperCall("Thing", {}, async () => Promise.reject(err))).rejects.toBe(err);
    expect(logError).not.toHaveBeenCalled();
  });

  it("logs the detail and answers with one fixed 502 carrying a stable code", async () => {
    const failure = await wrapperCall("Thing", { server: "smp" }, async () => {
      throw new Error("secret /srv/path");
    }).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(BadGateway);
    expect((failure as HttpError).statusCode).toBe(502);
    expect((failure as HttpError).body()).toEqual({ error: OPERATION_FAILED, code: "BAD_GATEWAY" });
    expect(logError).toHaveBeenCalledOnce();
    expect(String(logError.mock.calls[0]![1])).toContain("secret /srv/path");
    expect(OPERATION_FAILED).not.toMatch(/bot logs/i);
  });

  it("lets a caller translate a known failure and override the message", async () => {
    const translated = await wrapperCall(
      "Thing",
      {},
      async () => Promise.reject(new Error("x")),
      { translate: () => new Conflict("mine") },
    ).catch((e: unknown) => e);
    expect((translated as HttpError).statusCode).toBe(409);

    const custom = await wrapperCall(
      "Thing",
      {},
      async () => Promise.reject(new Error("x")),
      { message: "custom", translate: () => null },
    ).catch((e: unknown) => e);
    expect((custom as HttpError).message).toBe("custom");
  });
});

describe("auditAction", () => {
  it("records the action under the dashboard suffix with the session identity", async () => {
    await auditAction(
      { uid: "1", tag: "t#1", guilds: [], exp: 0 },
      { action: "mod install", server: "smp", detail: "sodium" },
    );
    expect(recordAdminActionMock).toHaveBeenCalledWith({
      action: "mod install (dashboard)",
      server: "smp",
      by: "t#1",
      byId: "1",
      detail: "sodium",
    });
  });
});

describe("busy mapping", () => {
  it("names what holds the instance", () => {
    expect(busyKind('API POST /x 423: {"busy":{"kind":"restore"}}')).toBe("restore");
    expect(busyKind("no body")).toBe("another operation");
  });

  it("maps only a wrapper 423 to a 409", () => {
    const busy = busyConflict(new ApiError("POST /x", 423, '{"busy":{"kind":"backup"}}'));
    expect(busy?.statusCode).toBe(409);
    expect(busy?.message).toContain("backup");
    expect(busyConflict(new ApiError("POST /x", 500, "boom"))).toBeNull();
    expect(busyConflict(new Error("other"))).toBeNull();
  });
});

describe("capabilityProbe", () => {
  it("asks once per server inside the TTL and answers 501 when unsupported", async () => {
    const supports = vi.fn(async () => false);
    const probe = capabilityProbe("test-feature", supports, "Cannot do it.");
    const cfg = { id: "smp" } as never;
    expect(await probe.supported("smp", cfg)).toBe(false);
    await expect(probe.requireSupport("smp", cfg)).rejects.toMatchObject({
      statusCode: 501,
      message: "Cannot do it.",
    });
    expect(supports).toHaveBeenCalledTimes(1);

    supports.mockResolvedValue(true);
    expect(await probe.supported("other", cfg)).toBe(true);
    await expect(probe.requireSupport("other", cfg)).resolves.toBeUndefined();
  });
});

describe("scriptResultBody", () => {
  it("keeps the tail of long output and reports success from the exit code", () => {
    const body = scriptResultBody({
      exitCode: 0,
      output: "x".repeat(5000) + "END",
      stderr: "",
    });
    expect(body.ok).toBe(true);
    expect(body.output).toHaveLength(4000);
    expect(body.output.endsWith("END")).toBe(true);
    expect(scriptResultBody({ exitCode: 1, output: "", stderr: "e" }).ok).toBe(false);
    expect(scriptResultBody({ exitCode: null, output: "", stderr: "" }).ok).toBe(false);
  });
});

describe("cache busting", () => {
  const fetchTimes = async (key: string, read: () => Promise<number>): Promise<number> =>
    cached(key, 60_000, read);

  it("drops a config file and its listing from both caches", async () => {
    await readThrough("smp", "configFile:f1", async () => 1);
    await readThrough("smp", "configIndex", async () => 2);
    const readFile = vi.fn(async () => 1);
    const readIndex = vi.fn(async () => 2);
    await fetchTimes("configFile:smp:f1", readFile);
    await fetchTimes("configIndex:smp", readIndex);

    bustConfigFile("smp", "f1");

    expect(recall("smp", "configFile:f1", "test")).toBeUndefined();
    expect(recall("smp", "configIndex", "test")).toBeUndefined();
    await fetchTimes("configFile:smp:f1", readFile);
    await fetchTimes("configIndex:smp", readIndex);
    expect(readFile).toHaveBeenCalledTimes(2);
    expect(readIndex).toHaveBeenCalledTimes(2);
  });

  it("drops the installed list (both caches) and the update check after a mod mutation", async () => {
    await readThrough("smp", "modsInstalled", async () => 1);
    const installed = vi.fn(async () => 1);
    const updates = vi.fn(async () => 1);
    await fetchTimes("mods:installed:smp", installed);
    await fetchTimes("mods:updates:smp", updates);

    bustMods("smp");

    expect(recall("smp", "modsInstalled", "test")).toBeUndefined();
    await fetchTimes("mods:installed:smp", installed);
    await fetchTimes("mods:updates:smp", updates);
    expect(installed).toHaveBeenCalledTimes(2);
    expect(updates).toHaveBeenCalledTimes(2);
  });
});
