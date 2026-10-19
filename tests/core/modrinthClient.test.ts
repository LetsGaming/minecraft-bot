import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  getProjectDetail,
  searchProjects,
  ModrinthError,
  MODRINTH_USER_AGENT,
} from "../../src/core/utils/modrinth.js";

const SEARCH = { query: "x", limit: 10, offset: 0, sort: "relevance", categories: [], hideClientOnly: false };

afterEach(() => vi.unstubAllGlobals());

function stubFetch(impl: (url: string, init?: RequestInit) => Promise<Response>) {
  const fn = vi.fn(impl);
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("Modrinth client failure mapping", () => {
  it("maps a 404 to not-found", async () => {
    stubFetch(async () => new Response("{}", { status: 404 }));
    await expect(getProjectDetail("nope")).rejects.toMatchObject({ kind: "not-found", status: 404 });
  });

  it("maps a 5xx to upstream with the status", async () => {
    stubFetch(async () => new Response("{}", { status: 503 }));
    await expect(getProjectDetail("x")).rejects.toMatchObject({ kind: "upstream", status: 503 });
  });

  it("maps a network failure to network and keeps the cause in the message", async () => {
    stubFetch(async () => {
      throw new TypeError("fetch failed", { cause: new Error("ECONNREFUSED") });
    });
    const err = await getProjectDetail("x").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ModrinthError);
    expect((err as ModrinthError).kind).toBe("network");
    expect((err as ModrinthError).message).toContain("ECONNREFUSED");
  });

  it("maps a non-JSON body to upstream", async () => {
    stubFetch(async () => new Response("<html>", { status: 200 }));
    await expect(getProjectDetail("x")).rejects.toMatchObject({ kind: "upstream" });
  });

  it("sends the shared User-Agent", async () => {
    const fetchMock = stubFetch(
      async () => new Response(JSON.stringify({ hits: [], total_hits: 0 }), { status: 200 }),
    );
    await searchProjects(SEARCH);
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>)["User-Agent"]).toBe(MODRINTH_USER_AGENT);
  });

  it("only passes Modrinth CDN icons through on search hits", async () => {
    stubFetch(
      async () =>
        new Response(
          JSON.stringify({
            hits: [
              { project_id: "a", slug: "a", icon_url: "https://cdn.modrinth.com/data/a/icon.png" },
              { project_id: "b", slug: "b", icon_url: "https://evil.example/x.png" },
            ],
            total_hits: 2,
          }),
          { status: 200 },
        ),
    );
    const result = await searchProjects(SEARCH);
    expect(result.hits.map((h) => h.iconUrl)).toEqual([
      "https://cdn.modrinth.com/data/a/icon.png",
      null,
    ]);
  });
});
