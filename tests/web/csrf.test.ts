/** AUD-017: cross-site writes to the API are refused. */
import { describe, it, expect, vi } from "vitest";

vi.mock("../../src/web/backend/auth/auth.js", () => ({
  publicBaseUrl: () => "https://mc.example.org",
}));

import { isCrossSiteWrite } from "../../src/web/backend/csrf.js";

function req(method: string, url: string, headers: Record<string, string> = {}) {
  return { method, url, headers: { host: "dash.lan:8130", ...headers } } as never;
}

describe("isCrossSiteWrite", () => {
  it("lets reads through whatever their origin", () => {
    expect(isCrossSiteWrite(req("GET", "/api/status", { "sec-fetch-site": "cross-site" }))).toBe(false);
  });

  it("uses Sec-Fetch-Site when the browser sends it", () => {
    expect(isCrossSiteWrite(req("POST", "/api/servers/a/restart", { "sec-fetch-site": "same-origin" }))).toBe(false);
    expect(isCrossSiteWrite(req("POST", "/api/servers/a/restart", { "sec-fetch-site": "same-site" }))).toBe(true);
    expect(isCrossSiteWrite(req("POST", "/api/servers/a/restart", { "sec-fetch-site": "cross-site" }))).toBe(true);
  });

  it("falls back to Origin: the addressed host or the public URL", () => {
    expect(isCrossSiteWrite(req("POST", "/api/x", { origin: "http://dash.lan:8130" }))).toBe(false);
    expect(isCrossSiteWrite(req("PUT", "/api/x", { origin: "https://mc.example.org" }))).toBe(false);
    // Another service on the same LAN host: same site, different origin.
    expect(isCrossSiteWrite(req("POST", "/api/x", { origin: "http://dash.lan:3000" }))).toBe(true);
    expect(isCrossSiteWrite(req("DELETE", "/api/x", { origin: "null" }))).toBe(true);
  });

  it("passes requests that no browser made", () => {
    expect(isCrossSiteWrite(req("POST", "/api/x"))).toBe(false);
  });

  it("leaves the OAuth surface alone", () => {
    expect(isCrossSiteWrite(req("POST", "/auth/logout", { "sec-fetch-site": "cross-site" }))).toBe(false);
  });
});
