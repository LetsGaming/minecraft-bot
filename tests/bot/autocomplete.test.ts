import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/core/config.js", () => ({
  getServerIds: () => ["smp", "creative", "skyblock"],
  loadConfig: () => ({ guilds: {}, language: "en" }),
}));

const router = vi.hoisted(() => ({
  filterTargetableServerIds: vi.fn(),
  tryResolveServer: vi.fn(),
}));
vi.mock("../../src/bot/utils/guild/guildRouter.js", () => router);

const getPlayerNames = vi.hoisted(() => vi.fn());
vi.mock("../../src/core/utils/minecraft/playerUtils.js", () => ({ getPlayerNames }));

import {
  defaultAutocomplete,
  dispatchAutocomplete,
  optionAutocomplete,
  serverCompleter,
} from "../../src/bot/utils/autocomplete.js";

function interaction(focused: { name: string; value: string }) {
  return {
    guild: { id: "g1" },
    options: { getFocused: () => focused },
    respond: vi.fn().mockResolvedValue(undefined),
  };
}

beforeEach(() => {
  router.filterTargetableServerIds
    .mockReset()
    .mockImplementation((_i: unknown, ids: string[]) => ids);
  router.tryResolveServer.mockReset().mockReturnValue({ id: "smp" });
  getPlayerNames.mockReset().mockResolvedValue(["Steve", "Alex", "stella"]);
});

describe("defaultAutocomplete", () => {
  it("suggests the servers the guild may target that match the typed prefix", async () => {
    router.filterTargetableServerIds.mockReturnValue(["smp", "skyblock"]);
    const i = interaction({ name: "server", value: "S" });
    await defaultAutocomplete(i as never);
    expect(router.filterTargetableServerIds).toHaveBeenCalledWith(i, ["smp", "creative", "skyblock"]);
    expect(i.respond).toHaveBeenCalledWith([
      { name: "smp", value: "smp" },
      { name: "skyblock", value: "skyblock" },
    ]);
  });

  it.each(["player", "player1", "player2"])("suggests player names for the %s option", async (name) => {
    const i = interaction({ name, value: "st" });
    await defaultAutocomplete(i as never);
    expect(i.respond).toHaveBeenCalledWith([
      { name: "Steve", value: "Steve" },
      { name: "stella", value: "stella" },
    ]);
  });

  it("offers nothing for other options and when the server cannot be resolved", async () => {
    const other = interaction({ name: "reason", value: "x" });
    await defaultAutocomplete(other as never);
    expect(other.respond).toHaveBeenCalledWith([]);

    router.tryResolveServer.mockReturnValue(null);
    const player = interaction({ name: "player", value: "" });
    await defaultAutocomplete(player as never);
    expect(player.respond).toHaveBeenCalledWith([]);
  });

  it("answers with no choices when a completer fails", async () => {
    getPlayerNames.mockRejectedValue(new Error("unreachable"));
    const i = interaction({ name: "player", value: "" });
    await defaultAutocomplete(i as never);
    expect(i.respond).toHaveBeenCalledWith([]);
  });

  it("caps the choices at 25", async () => {
    getPlayerNames.mockResolvedValue(Array.from({ length: 40 }, (_, n) => `p${n}`));
    const i = interaction({ name: "player", value: "p" });
    await defaultAutocomplete(i as never);
    expect(i.respond.mock.calls[0]![0]).toHaveLength(25);
  });

  it("does not resolve inherited property names as completers", async () => {
    const i = interaction({ name: "constructor", value: "" });
    await defaultAutocomplete(i as never);
    expect(i.respond).toHaveBeenCalledWith([]);
  });
});

describe("serverCompleter with includeAll", () => {
  it("puts the all-servers choice first when the typed text matches it", async () => {
    const handler = optionAutocomplete({ server: serverCompleter({ includeAll: true }) });
    const i = interaction({ name: "server", value: "" });
    await handler(i as never);
    const choices = i.respond.mock.calls[0]![0] as Array<{ value: string }>;
    expect(choices[0]!.value).toBe("all");
    expect(choices.map((c) => c.value)).toContain("smp");

    const narrowed = interaction({ name: "server", value: "sm" });
    await handler(narrowed as never);
    expect((narrowed.respond.mock.calls[0]![0] as Array<{ value: string }>).map((c) => c.value)).toEqual(["smp"]);
  });
});

describe("dispatchAutocomplete", () => {
  it("prefers the command's own handler over the default", async () => {
    const own = vi.fn().mockResolvedValue(undefined);
    const i = interaction({ name: "server", value: "" });
    await dispatchAutocomplete(i as never, { autocomplete: own });
    expect(own).toHaveBeenCalledWith(i);
    expect(i.respond).not.toHaveBeenCalled();
  });

  it("falls back to the default for a command without one", async () => {
    const i = interaction({ name: "reason", value: "" });
    await dispatchAutocomplete(i as never, {});
    expect(i.respond).toHaveBeenCalledWith([]);
  });
});
