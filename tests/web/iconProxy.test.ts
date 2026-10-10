import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  fetchIcon,
  clearIconCache,
  ICON_MAX_BYTES,
  ICON_MAX_ENTRIES,
} from "../../src/web/backend/iconProxy.js";

function respond(body: Uint8Array | string, headers: Record<string, string> = {}, status = 200) {
  return new Response(body as BodyInit, {
    status,
    headers: { "content-type": "image/png", ...headers },
  });
}

const fetchMock = vi.fn();

beforeEach(() => {
  clearIconCache();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("fetchIcon", () => {
  it("returns a small PNG and caches it", async () => {
    fetchMock.mockImplementation(async () => respond(new Uint8Array([1, 2, 3])));
    const first = await fetchIcon("https://cdn.modrinth.com/a.png", "ua");
    const second = await fetchIcon("https://cdn.modrinth.com/a.png", "ua");
    expect(first.contentType).toBe("image/png");
    expect([...first.body]).toEqual([1, 2, 3]);
    expect(second).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects non-image content types, including SVG", async () => {
    for (const type of ["text/html", "image/svg+xml", "application/octet-stream", ""]) {
      fetchMock.mockImplementationOnce(async () => respond("x", { "content-type": type }));
      await expect(fetchIcon(`https://cdn.modrinth.com/${type.length}`, "ua")).rejects.toMatchObject({
        statusCode: 502,
      });
    }
  });

  it("rejects a declared length over the cap without reading the body", async () => {
    fetchMock.mockImplementation(async () =>
      respond("x", { "content-length": String(ICON_MAX_BYTES + 1) }),
    );
    await expect(fetchIcon("https://cdn.modrinth.com/big.png", "ua")).rejects.toMatchObject({
      statusCode: 502,
    });
  });

  it("aborts a streamed body that grows past the cap", async () => {
    fetchMock.mockImplementation(async () => respond(new Uint8Array(ICON_MAX_BYTES + 10)));
    await expect(fetchIcon("https://cdn.modrinth.com/stream.png", "ua")).rejects.toMatchObject({
      statusCode: 502,
    });
  });

  it("does not cache failures", async () => {
    fetchMock.mockImplementationOnce(async () => respond("x", {}, 500));
    await expect(fetchIcon("https://cdn.modrinth.com/f.png", "ua")).rejects.toBeDefined();
    fetchMock.mockImplementationOnce(async () => respond(new Uint8Array([9])));
    await expect(fetchIcon("https://cdn.modrinth.com/f.png", "ua")).resolves.toBeDefined();
  });

  it("evicts the oldest entries beyond the entry cap", async () => {
    fetchMock.mockImplementation(async () => respond(new Uint8Array([1])));
    for (let i = 0; i < ICON_MAX_ENTRIES + 5; i++) {
      await fetchIcon(`https://cdn.modrinth.com/${i}.png`, "ua");
    }
    fetchMock.mockClear();
    await fetchIcon(`https://cdn.modrinth.com/${ICON_MAX_ENTRIES + 4}.png`, "ua");
    expect(fetchMock).not.toHaveBeenCalled();
    await fetchIcon("https://cdn.modrinth.com/0.png", "ua");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
