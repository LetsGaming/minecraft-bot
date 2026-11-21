/**
 * /skin: whose head a caller may show or refresh, and what the reply says.
 * The mc-heads probe is faked; the head store is the real one on the test database.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { SNAPSHOT_CONFIG, recordingInteraction } from "../bot/discordSnapshots/render.js";

vi.mock("../../src/core/config.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  loadConfig: () => SNAPSHOT_CONFIG,
}));
vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const mocks = vi.hoisted(() => ({
  linked: null as string | null,
  probe: vi.fn(),
  resolve: vi.fn(),
}));

vi.mock("../../src/core/utils/stores/linkStore.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getLinkedAccount: vi.fn(async () => mocks.linked),
}));
vi.mock("../../src/core/utils/minecraft/skinResolver.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  resolveSkin: mocks.resolve,
}));
vi.mock("../../src/core/utils/minecraft/playerHead.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  probeHead: mocks.probe,
}));

import { closeDbForTesting } from "../../src/core/db/index.js";
import { headInfo, setSkin } from "../../src/core/utils/stores/headStore.js";

const GOOD = { ok: true, status: 200, bytes: 337, ageSeconds: 6000, cache: "HIT" };

async function run(
  subcommand: "show" | "refresh",
  { player = null, admin = false }: { player?: string | null; admin?: boolean } = {},
): Promise<string> {
  const { execute } = await import("../../src/bot/commands/connection/skin.js");
  const { interaction, sent } = recordingInteraction("en", { commandName: "skin", subcommand, admin });
  interaction.options.getString = ((name: string) => (name === "player" ? player : null)) as never;
  await execute(interaction as never);
  return JSON.stringify(sent);
}

beforeEach(() => {
  closeDbForTesting();
  mocks.linked = "Steve";
  mocks.probe.mockReset().mockResolvedValue(GOOD);
  mocks.resolve.mockReset().mockResolvedValue({ kind: "unchanged", hash: null });
});

describe("/skin show", () => {
  it("shows the caller's linked head and the age of the mc-heads copy", async () => {
    const out = await run("show");
    expect(out).toContain("Head of Steve");
    expect(out).toContain("mc-heads copy: 1 h 40 min old, 337 bytes");
    expect(out).toContain("No manual refresh yet");
    expect(headInfo("Steve")).toBeNull();
  });

  it("says so when mc-heads returns no image", async () => {
    mocks.probe.mockResolvedValue({ ok: false, status: 502, bytes: null, ageSeconds: null, cache: null });
    expect(await run("show")).toContain("mc-heads did not return an image");
  });

  it("shows a fresh copy without an age", async () => {
    mocks.probe.mockResolvedValue({ ...GOOD, ageSeconds: 0 });
    expect(await run("show")).toContain("fetched fresh from the skin source");
  });

  it("asks an unlinked caller to link", async () => {
    mocks.linked = null;
    expect(await run("show")).toContain("not linked");
    expect(mocks.probe).not.toHaveBeenCalled();
  });

  it("rejects a name that is not a Minecraft name", async () => {
    expect(await run("show", { player: "no spaces!" })).toContain("not a valid Minecraft username");
  });
});

describe("/skin refresh", () => {
  it("refreshes the caller's own head", async () => {
    const out = await run("refresh");
    expect(out).toContain("Refreshed.");
    expect(headInfo("Steve")?.by).toBe("player-1");
  });

  it("lets a player name their own account in any casing", async () => {
    await run("refresh", { player: "steve" });
    expect(headInfo("Steve")).not.toBeNull();
  });

  it("denies another player's head to a non-admin and changes nothing", async () => {
    const out = await run("refresh", { player: "Alex" });
    expect(out).not.toContain("Head of Alex");
    expect(headInfo("Alex")).toBeNull();
    expect(mocks.probe).not.toHaveBeenCalled();
  });

  it("denies showing another player's head to a non-admin", async () => {
    await run("show", { player: "Alex" });
    expect(mocks.probe).not.toHaveBeenCalled();
  });

  it("lets an admin refresh another player's head", async () => {
    const out = await run("refresh", { player: "Alex", admin: true });
    expect(out).toContain("Head of Alex");
    expect(headInfo("Alex")?.by).toBe("admin-1");
  });

  it("shows who refreshed last on the next /skin show", async () => {
    await run("refresh");
    expect(await run("show")).toContain("Last manual refresh:");
  });
});

describe("/skin and the skin check", () => {
  it("reads the skin from Mojang on refresh, before the head address changes", async () => {
    const order: string[] = [];
    mocks.resolve.mockImplementation(async () => {
      order.push(`resolve (refreshed yet: ${headInfo("Steve") !== null})`);
      return { kind: "changed", hash: "a".repeat(64), previous: null };
    });
    const out = await run("refresh");
    expect(order).toEqual(["resolve (refreshed yet: false)"]);
    expect(mocks.resolve).toHaveBeenCalledWith("Steve");
    expect(out).toContain("Mojang has a different skin for this player now");
  });

  it("does not ask Mojang on show", async () => {
    await run("show");
    expect(mocks.resolve).not.toHaveBeenCalled();
  });

  it.each([
    [{ kind: "unchanged", hash: null }, "Mojang confirms the skin is unchanged"],
    [{ kind: "unknown-account" }, "Mojang does not know this name"],
    [{ kind: "rejected", hash: "b".repeat(64) }, "mc-heads cannot render this skin right now"],
    [{ kind: "unavailable", rateLimited: true }, "Mojang did not answer"],
  ])("says what Mojang answered on refresh: %j", async (outcome, text) => {
    mocks.resolve.mockResolvedValue(outcome);
    expect(await run("refresh")).toContain(text);
  });

  it("does not ask Mojang for another player's head when the caller may not touch it", async () => {
    await run("refresh", { player: "Alex" });
    expect(mocks.resolve).not.toHaveBeenCalled();
  });

  it("says the head is looked up by name until Mojang was asked", async () => {
    expect(await run("show")).toContain("looked up by name");
  });

  it("shows the skin the head follows, and a default skin", async () => {
    setSkin("Steve", "abcdef0123456789".repeat(4));
    expect(await run("show")).toContain("Head follows the skin `abcdef01`");
    setSkin("Steve", null);
    expect(await run("show")).toContain("Mojang says this account has the default skin");
  });
});
