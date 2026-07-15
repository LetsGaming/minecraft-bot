/**
 * The required-config setup guard: when a mandatory dashboard secret is
 * missing, every request should get a clear setup page (HTML) or JSON error
 * instead of an opaque 500 — except /healthz, so the container stays up. Once
 * the secrets are present the guard registers nothing and requests flow
 * normally. Env is saved/restored so this file can't leak state to others.
 */
import { describe, it, expect, afterEach } from "vitest";
import { buildServer } from "../../src/web/backend/server.js";
import { missingWebEnv } from "../../src/web/backend/requiredEnv.js";

const SAVED = {
  session: process.env.WEBUI_SESSION_SECRET,
  client: process.env.WEBUI_CLIENT_SECRET,
};
function restore(key: "WEBUI_SESSION_SECRET" | "WEBUI_CLIENT_SECRET", v?: string) {
  if (v === undefined) delete process.env[key];
  else process.env[key] = v;
}
afterEach(() => {
  restore("WEBUI_SESSION_SECRET", SAVED.session);
  restore("WEBUI_CLIENT_SECRET", SAVED.client);
});

describe("missingWebEnv", () => {
  it("reports both secrets when unset", () => {
    delete process.env.WEBUI_SESSION_SECRET;
    delete process.env.WEBUI_CLIENT_SECRET;
    expect(missingWebEnv().map((m) => m.name)).toEqual([
      "WEBUI_SESSION_SECRET",
      "WEBUI_CLIENT_SECRET",
    ]);
  });

  it("flags a session secret shorter than 16 chars", () => {
    process.env.WEBUI_SESSION_SECRET = "tooshort";
    process.env.WEBUI_CLIENT_SECRET = "present";
    const m = missingWebEnv();
    expect(m).toHaveLength(1);
    expect(m[0]!.reason).toMatch(/16 characters/);
  });

  it("reports nothing when both are set adequately", () => {
    process.env.WEBUI_SESSION_SECRET = "a-sufficiently-long-secret-value";
    process.env.WEBUI_CLIENT_SECRET = "present";
    expect(missingWebEnv()).toEqual([]);
  });
});

describe("setup guard (buildServer)", () => {
  it("serves an HTML setup page to a browser when misconfigured", async () => {
    delete process.env.WEBUI_SESSION_SECRET;
    delete process.env.WEBUI_CLIENT_SECRET;
    const app = buildServer();
    const res = await app.inject({
      method: "GET",
      url: "/",
      headers: { accept: "text/html" },
    });
    expect(res.statusCode).toBe(503);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toContain("Dashboard setup required");
    expect(res.body).toContain("WEBUI_SESSION_SECRET");
    expect(res.body).toContain("WEBUI_CLIENT_SECRET");
    await app.close();
  });

  it("returns JSON with the missing names for API calls", async () => {
    delete process.env.WEBUI_SESSION_SECRET;
    delete process.env.WEBUI_CLIENT_SECRET;
    const app = buildServer();
    const res = await app.inject({ method: "GET", url: "/api/me" });
    expect(res.statusCode).toBe(503);
    expect(res.json().missing).toContain("WEBUI_SESSION_SECRET");
    await app.close();
  });

  it("exempts /healthz so the container health probe still passes", async () => {
    delete process.env.WEBUI_SESSION_SECRET;
    delete process.env.WEBUI_CLIENT_SECRET;
    const app = buildServer();
    const res = await app.inject({ method: "GET", url: "/healthz" });
    expect(res.statusCode).not.toBe(503);
    await app.close();
  });

  it("does not intercept once both secrets are set", async () => {
    process.env.WEBUI_SESSION_SECRET = "a-sufficiently-long-secret-value";
    process.env.WEBUI_CLIENT_SECRET = "present";
    const app = buildServer();
    // No cookie → the normal unauthorized path, NOT the 503 setup guard.
    const res = await app.inject({ method: "GET", url: "/api/me" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});
