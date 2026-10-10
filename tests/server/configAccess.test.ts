/**
 * Config calls to the wrapper: normalisation of the index and the typed
 * errors a route can show a person.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import {
  indexConfigFiles,
  readConfigFile,
  writeConfigFile,
} from "../../src/core/utils/server/serverAccess.js";
import { ConfigAccessError } from "../../src/core/utils/server/configAccessError.js";
import { resetBreakersForTesting } from "../../src/core/utils/server/circuitBreaker.js";

const cfg = { id: "smp", apiUrl: "https://api.example.com", apiKey: "k" } as never;

function res(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(JSON.stringify(body)),
  };
}

beforeEach(() => {
  mockFetch.mockReset();
  resetBreakersForTesting();
});

describe("indexConfigFiles", () => {
  it("fills in fields an older wrapper omits", async () => {
    mockFetch.mockResolvedValueOnce(
      res(200, { files: [{ id: "a", relPath: "config/a.toml", modId: "a", format: "toml", sizeBytes: 1, mtimeMs: 1 }] }),
    );
    const { files, truncated } = await indexConfigFiles(cfg);
    expect(files[0]).toMatchObject({ editable: true, tooLarge: false });
    expect(truncated).toBe(false);
  });

  it("passes the truncated flag through", async () => {
    mockFetch.mockResolvedValueOnce(res(200, { files: [], truncated: true }));
    expect((await indexConfigFiles(cfg)).truncated).toBe(true);
  });
});

describe("writeConfigFile errors", () => {
  const write = () => writeConfigFile(cfg, "A".repeat(22), "text", "etag");

  it("returns a conflict for 412", async () => {
    mockFetch.mockResolvedValueOnce(res(412, { error: "changed" }));
    await expect(write()).resolves.toEqual({ ok: false, conflict: true });
  });

  it.each([
    [413, "too-large"],
    [404, "not-found"],
    [428, "precondition-required"],
    [429, "rate-limited"],
    [400, "rejected"],
  ])("maps %i to %s", async (status, kind) => {
    mockFetch.mockResolvedValueOnce(res(status, { error: "x" }));
    const err = await write().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConfigAccessError);
    expect((err as ConfigAccessError).kind).toBe(kind);
    expect((err as ConfigAccessError).message.length).toBeGreaterThan(10);
  });

  it("leaves a 500 as a plain error", async () => {
    mockFetch.mockResolvedValueOnce(res(500, { error: "boom" }));
    const err = await write().catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(ConfigAccessError);
  });
});

describe("readConfigFile errors", () => {
  it("maps a too-large read to a typed error", async () => {
    mockFetch.mockResolvedValueOnce(res(413, { error: "too big" }));
    const err = await readConfigFile(cfg, "A".repeat(22)).catch((e: unknown) => e);
    expect((err as ConfigAccessError).kind).toBe("too-large");
  });

  it("maps a missing file to not-found", async () => {
    mockFetch.mockResolvedValueOnce(res(404, { error: "no" }));
    const err = await readConfigFile(cfg, "A".repeat(22)).catch((e: unknown) => e);
    expect((err as ConfigAccessError).kind).toBe("not-found");
  });
});
