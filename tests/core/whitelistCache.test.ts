import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/core/utils/server/serverAccess.js", () => ({
  readWhitelist: vi.fn(),
  readUserCache: vi.fn().mockResolvedValue([]),
}));

import * as serverAccess from "../../src/core/utils/server/serverAccess.js";
import {
  invalidateWhitelistCache,
  loadKnownPlayers,
  loadWhitelist,
  reloadKnownPlayers,
} from "../../src/core/utils/minecraft/whitelist.js";
import type { ServerInstance } from "../../src/core/utils/server/server.js";

const server = { id: "s", config: { id: "s" } } as unknown as ServerInstance;

beforeEach(() => {
  vi.clearAllMocks();
  invalidateWhitelistCache();
  vi.mocked(serverAccess.readWhitelist).mockResolvedValue([{ name: "A", uuid: "u1" }] as never);
  vi.mocked(serverAccess.readUserCache).mockResolvedValue([]);
});

describe("whitelist cache", () => {
  it("collapses concurrent misses into one wrapper read", async () => {
    await Promise.all([loadWhitelist(false, server), loadWhitelist(false, server)]);
    expect(serverAccess.readWhitelist).toHaveBeenCalledTimes(1);
  });

  it("does not store a read that began before an invalidation", async () => {
    let release!: (v: never) => void;
    vi.mocked(serverAccess.readWhitelist).mockImplementationOnce(
      () => new Promise((resolve) => (release = resolve as typeof release)),
    );
    const slow = loadWhitelist(false, server);
    invalidateWhitelistCache("s");
    release([{ name: "Stale", uuid: "u0" }] as never);
    await slow;

    const fresh = await loadWhitelist(false, server);
    expect(fresh?.map((p) => p.name)).toEqual(["A"]);
  });

  it("reloadKnownPlayers re-reads both files", async () => {
    await loadKnownPlayers(server);
    await reloadKnownPlayers(server);
    expect(serverAccess.readWhitelist).toHaveBeenCalledTimes(2);
    expect(serverAccess.readUserCache).toHaveBeenCalledTimes(2);
  });
});
