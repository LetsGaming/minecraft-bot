import { describe, it, expect, vi, afterEach } from "vitest";
import {
  apiGet,
  apiSend,
  ApiError,
  UnauthorizedError,
  isConflict,
  validationErrors,
} from "../../src/web/frontend/src/api.js";

function respond(status: number, body?: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => {
        if (body === undefined) throw new Error("no body");
        return body;
      },
    })),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("ApiError", () => {
  it("carries status, code and body from the backend answer", async () => {
    respond(409, { error: "changed", code: "CONFLICT", currentHash: "h" });
    const err = await apiSend("PUT", "/api/config", {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    const api = err as ApiError;
    expect(api.status).toBe(409);
    expect(api.code).toBe("CONFLICT");
    expect(api.message).toBe("changed");
    expect(api.body).toMatchObject({ currentHash: "h" });
    expect(isConflict(api)).toBe(true);
  });

  it("treats a bare 409 as a conflict even without a code", async () => {
    respond(409, { error: "changed" });
    const err = await apiGet("/x").catch((e: unknown) => e);
    expect(isConflict(err)).toBe(true);
  });

  it("does not call other failures conflicts", async () => {
    respond(500, { error: "boom" });
    const err = await apiGet("/x").catch((e: unknown) => e);
    expect(isConflict(err)).toBe(false);
    expect(isConflict(new Error("409 conflict changed since you loaded it"))).toBe(false);
  });

  it("exposes the validation list", async () => {
    respond(422, { error: "Validation failed", code: "VALIDATION_FAILED", errors: ["a", "b"] });
    const err = await apiSend("PUT", "/x", {}).catch((e: unknown) => e);
    expect(validationErrors(err)).toEqual(["a", "b"]);
    expect(validationErrors(new Error("x"))).toEqual([]);
  });

  it("keeps the status when the body is not JSON", async () => {
    respond(502);
    const err = (await apiGet("/x").catch((e: unknown) => e)) as ApiError;
    expect(err.status).toBe(502);
    expect(err.message).toBe("Request failed (502)");
    expect(err.code).toBeUndefined();
  });

  it("keeps 401 as UnauthorizedError", async () => {
    respond(401, { error: "no" });
    await expect(apiGet("/x")).rejects.toBeInstanceOf(UnauthorizedError);
  });
});
