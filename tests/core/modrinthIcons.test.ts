import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  lookupProjectIcons,
  clearProjectIconCache,
  ICON_LOOKUP_BATCH,
  ICON_LOOKUP_MAX_KEYS,
  ICON_CACHE_MAX_ENTRIES,
} from "../../src/core/utils/modrinth.js";

const CDN = "https://cdn.modrinth.com/data";

function project(slug: string, icon: string | null = `${CDN}/${slug}/icon.png`, id = `id-${slug}`) {
  return { id, slug, icon_url: icon };
}

let fetchMock: ReturnType<typeof vi.fn>;
let respond: (keys: string[]) => Response | Promise<Response>;

function requestedKeys(call: unknown[]): string[] {
  const url = new URL(String(call[0]));
  return JSON.parse(url.searchParams.get("ids") ?? "[]") as string[];
}

beforeEach(() => {
  clearProjectIconCache();
  respond = (keys) => new Response(JSON.stringify(keys.map((k) => project(k))), { status: 200 });
  fetchMock = vi.fn(async (url: string) => respond(requestedKeys([url])));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("lookupProjectIcons", () => {
  it("asks Modrinth's bulk endpoint once and maps slugs and ids to icons", async () => {
    respond = () =>
      new Response(JSON.stringify([project("sodium"), project("lithium", null), project("fabric-api", undefined, "P7dR8mSH")]));
    const icons = await lookupProjectIcons(["Sodium", "lithium", "P7dR8mSH", "sodium"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = new URL(String(fetchMock.mock.calls[0]![0]));
    expect(url.origin + url.pathname).toBe("https://api.modrinth.com/v2/projects");
    expect(requestedKeys(fetchMock.mock.calls[0]!)).toEqual(["sodium", "lithium", "p7dr8msh"]);
    expect(icons.get("sodium")).toBe(`${CDN}/sodium/icon.png`);
    expect(icons.has("lithium")).toBe(false);
    expect(icons.get("p7dr8msh")).toBe(`${CDN}/fabric-api/icon.png`);
  });

  it("serves repeats from the cache, including projects Modrinth does not know", async () => {
    respond = () => new Response(JSON.stringify([project("sodium")]));
    await lookupProjectIcons(["sodium", "my-local-jar"]);
    const again = await lookupProjectIcons(["sodium", "my-local-jar"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect([...again.keys()]).toEqual(["sodium"]);
  });

  it("asks a miss again once its shorter cache time has passed", async () => {
    vi.useFakeTimers();
    respond = () => new Response("[]");
    await lookupProjectIcons(["my-local-jar"]);
    vi.advanceTimersByTime(61 * 60 * 1000);
    await lookupProjectIcons(["my-local-jar"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("splits large lists into bounded batches and caps the keys per lookup", async () => {
    const keys = Array.from({ length: ICON_LOOKUP_MAX_KEYS + 40 }, (_, i) => `mod-${i}`);
    const icons = await lookupProjectIcons(keys);
    const sizes = fetchMock.mock.calls.map((c) => requestedKeys(c).length);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(ICON_LOOKUP_BATCH);
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(ICON_LOOKUP_MAX_KEYS);
    expect(icons.size).toBe(ICON_LOOKUP_MAX_KEYS);
    expect(icons.has(`mod-${ICON_LOOKUP_MAX_KEYS}`)).toBe(false);
  });

  it("drops keys that are not slug or id shaped before any request", async () => {
    await lookupProjectIcons(["../x", "a b", "", "x".repeat(65), '"]&ids=["evil']);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never returns an icon off Modrinth's CDN or over plain http", async () => {
    respond = () =>
      new Response(
        JSON.stringify([
          project("a", "https://evil.example/icon.png"),
          project("b", "http://cdn.modrinth.com/data/b/icon.png"),
          project("c", "javascript:alert(1)"),
          project("d"),
        ]),
      );
    const icons = await lookupProjectIcons(["a", "b", "c", "d"]);
    expect([...icons.keys()]).toEqual(["d"]);
  });

  it("degrades to no icons when Modrinth fails, and rests before asking again", async () => {
    vi.useFakeTimers();
    respond = () => new Response("oops", { status: 503 });
    await expect(lookupProjectIcons(["sodium"])).resolves.toEqual(new Map());
    await lookupProjectIcons(["sodium"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(61 * 1000);
    respond = (keys) => new Response(JSON.stringify(keys.map((k) => project(k))));
    const icons = await lookupProjectIcons(["sodium"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(icons.size).toBe(1);
  });

  it("degrades to no icons on a network error or a malformed body", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    await expect(lookupProjectIcons(["a"])).resolves.toEqual(new Map());
    respond = () => new Response("not json");
    await expect(lookupProjectIcons(["b"])).resolves.toEqual(new Map());
  });

  it("concurrent lookups of the same key share one request", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    respond = async (keys) => {
      await gate;
      return new Response(JSON.stringify(keys.map((k) => project(k))));
    };
    const first = lookupProjectIcons(["sodium"]);
    const second = lookupProjectIcons(["sodium"]);
    release();
    const [a, b] = await Promise.all([first, second]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a.get("sodium")).toBe(b.get("sodium"));
  });

  it("keeps the cache bounded", async () => {
    const total = ICON_CACHE_MAX_ENTRIES + 100;
    for (let i = 0; i < total; i += ICON_LOOKUP_MAX_KEYS) {
      await lookupProjectIcons(Array.from({ length: Math.min(ICON_LOOKUP_MAX_KEYS, total - i) }, (_, j) => `k-${i + j}`));
    }
    const calls = fetchMock.mock.calls.length;
    await lookupProjectIcons(["k-0"]);
    expect(fetchMock.mock.calls.length).toBe(calls + 1);
    await lookupProjectIcons([`k-${total - 1}`]);
    expect(fetchMock.mock.calls.length).toBe(calls + 1);
  });
});
