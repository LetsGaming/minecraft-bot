import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { useMods } from "../../src/web/frontend/src/composables/useMods.js";
import { ApiError, UnauthorizedError } from "../../src/web/frontend/src/api.js";

interface Call {
  url: string;
  method: string;
  body: unknown;
}

let calls: Call[] = [];
let answer: { status: number; body: unknown } = { status: 200, body: { ok: true } };

beforeEach(() => {
  calls = [];
  answer = { status: 200, body: { ok: true } };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({
        url,
        method: init?.method ?? "GET",
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      return new Response(JSON.stringify(answer.body), { status: answer.status });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const mods = useMods(() => "smp one");

describe("installed list", () => {
  it("reads the installed list of the active server, encoding its id", async () => {
    answer.body = { gameVersion: "1.21.4", modLoader: "fabric", mtimeMs: 1, mods: [] };
    const list = await mods.fetchInstalled();
    expect(calls).toEqual([{ url: "/api/servers/smp%20one/mods/installed", method: "GET", body: undefined }]);
    expect(list.gameVersion).toBe("1.21.4");
  });

  it("follows the server getter, so a server switch needs no new composable", async () => {
    let id = "a";
    const scoped = useMods(() => id);
    await scoped.fetchInstalled();
    id = "b";
    await scoped.fetchInstalled();
    expect(calls.map((c) => c.url)).toEqual(["/api/servers/a/mods/installed", "/api/servers/b/mods/installed"]);
  });

  it("surfaces a failed read as an ApiError with the backend's message", async () => {
    answer = { status: 502, body: { error: "The operation failed unexpectedly." } };
    await expect(mods.fetchInstalled()).rejects.toMatchObject({
      status: 502,
      message: "The operation failed unexpectedly.",
    });
    await expect(mods.fetchInstalled()).rejects.toBeInstanceOf(ApiError);
  });

  it("surfaces a 401 as UnauthorizedError", async () => {
    answer = { status: 401, body: {} };
    await expect(mods.fetchInstalled()).rejects.toBeInstanceOf(UnauthorizedError);
  });
});

describe("update check", () => {
  it("uses the cached answer unless asked to refresh", async () => {
    answer.body = { results: [] };
    await mods.checkUpdates();
    await mods.checkUpdates(true);
    expect(calls.map((c) => c.url)).toEqual([
      "/api/servers/smp%20one/mods/updates",
      "/api/servers/smp%20one/mods/updates?refresh=true",
    ]);
  });
});

describe("row mutations", () => {
  it("removes one mod by slug with DELETE", async () => {
    await mods.remove("fabric api");
    expect(calls).toEqual([{ url: "/api/servers/smp%20one/mods/fabric%20api", method: "DELETE", body: undefined }]);
  });

  it("updates, disables and enables one mod with an empty POST body", async () => {
    await mods.updateOne("sodium");
    await mods.disable("sodium");
    await mods.enable("sodium");
    expect(calls).toEqual([
      { url: "/api/servers/smp%20one/mods/sodium/update", method: "POST", body: {} },
      { url: "/api/servers/smp%20one/mods/sodium/disable", method: "POST", body: {} },
      { url: "/api/servers/smp%20one/mods/sodium/enable", method: "POST", body: {} },
    ]);
  });

  it("applies every update, optionally for a target version", async () => {
    await mods.applyUpdates();
    await mods.applyUpdates("1.21.5");
    expect(calls.map((c) => c.body)).toEqual([{}, { mcVersion: "1.21.5" }]);
    expect(calls.every((c) => c.method === "POST" && c.url === "/api/servers/smp%20one/mods/updates")).toBe(true);
  });

  it("installs by slug with only the fields that were given", async () => {
    await mods.install({ slug: "lithium" });
    await mods.install({ slug: "lithium", mcVersion: "1.21.4", versionId: "abc" });
    expect(calls.map((c) => c.body)).toEqual([
      { slug: "lithium" },
      { slug: "lithium", mcVersion: "1.21.4", versionId: "abc" },
    ]);
  });

  it("returns the wrapper's ok:false answer instead of throwing", async () => {
    answer.body = { ok: false, error: "not installed" };
    await expect(mods.remove("ghost")).resolves.toEqual({ ok: false, error: "not installed" });
  });
});

describe("catalogue", () => {
  it("sends only the search options that differ from the defaults", async () => {
    answer.body = { hits: [], offset: 0, limit: 20, totalHits: 0 };
    await mods.search({ query: "", limit: 20, offset: 0 });
    await mods.search({ query: "sod", sort: "downloads", compatible: false, hideClientOnly: false, limit: 20, offset: 40 });
    expect(calls.map((c) => c.url)).toEqual([
      "/api/servers/smp%20one/mods/search?limit=20&offset=0",
      "/api/servers/smp%20one/mods/search?query=sod&sort=downloads&limit=20&offset=40&compatible=false&hideClientOnly=false",
    ]);
  });

  it("reads one project's versions by slug", async () => {
    await mods.catalog("mod/menu");
    expect(calls[0]!.url).toBe("/api/servers/smp%20one/mods/catalog/mod%2Fmenu");
  });
});
