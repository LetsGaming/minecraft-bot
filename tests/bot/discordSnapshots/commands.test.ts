/**
 * Snapshots of slash command replies, rendered through the real commands,
 * middleware and embed builders in English and German. Only data access is
 * faked. `npm run discord:snapshots` prints them for reading.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import {
  GUILD,
  LANGUAGES,
  NOW,
  SNAPSHOT_CONFIG,
  fixturePath,
  recordingInteraction,
  renderEmbed,
  renderMessage,
  renderRow,
  stringify,
  type Language,
} from "./render.js";

vi.mock("../../../src/core/config.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  loadConfig: () => SNAPSHOT_CONFIG,
}));
vi.mock("../../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../../src/bot/utils/guild/guildRouter.js", () => ({ resolveServer: vi.fn() }));
vi.mock("../../../src/bot/utils/hints/followUps.js", () => ({
  attachFollowUpHint: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../../src/core/utils/server/hostResources.js", () => ({
  getHostResources: vi.fn().mockResolvedValue(null),
}));
vi.mock("../../../src/core/utils/minecraft/playerUtils.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getOnlinePlayers: vi.fn().mockResolvedValue(["Marlene_B", "TheRedstoneKid", "ikarus_77"]),
}));
vi.mock("../../../src/core/utils/server/serverAccess.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  readBackups: vi.fn(),
  runScript: vi.fn(),
  pingServer: vi.fn().mockResolvedValue({ kind: "status", result: { version: "Fabric 1.21.1" } }),
}));
vi.mock("../../../src/core/utils/stores/uptimeTracker.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getUptimeStats: vi.fn(),
}));
vi.mock("../../../src/core/utils/minecraft/modUtils.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getModList: vi.fn(),
}));
vi.mock("../../../src/core/utils/wrapper/lastKnown.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  readThrough: vi.fn(async (_id: string, _key: string, read: () => Promise<unknown>) => ({
    value: await read(),
    stale: null,
  })),
}));
vi.mock("../../../src/core/utils/minecraft/statUtils.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  loadAllStats: vi.fn(),
}));
vi.mock("../../../src/core/utils/stores/adminAudit.js", () => ({
  recordAdminAction: vi.fn().mockResolvedValue(undefined),
  loadAdminAudit: vi.fn().mockResolvedValue([]),
}));
vi.mock("../../../src/bot/logWatcher/watchers/monitors/downtimeMonitor.js", () => ({
  suppressAlerts: vi.fn(),
}));

import { resolveServer } from "../../../src/bot/utils/guild/guildRouter.js";
import * as serverAccess from "../../../src/core/utils/server/serverAccess.js";
import { getModList } from "../../../src/core/utils/minecraft/modUtils.js";
import { loadAllStats } from "../../../src/core/utils/minecraft/statUtils.js";
import { runWithGuildLocale } from "../../../src/core/utils/i18n.js";
import { getUptimeStats } from "../../../src/core/utils/stores/uptimeTracker.js";
import { recordControlAction } from "../../../src/core/utils/stores/serverControlRecord.js";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
});
afterAll(() => {
  vi.useRealTimers();
});

function health(state: string, wrapper: "up" | "unreachable" = "up") {
  return {
    state,
    source: wrapper === "up" ? "wrapper" : state === "unknown" ? "none" : "ping",
    wrapper,
    processUp: state === "online" || state === "unresponsive",
    rcon: state === "online" && wrapper === "up" ? "responsive" : "unknown",
    probe: state === "offline" ? "none" : "socket",
    players:
      wrapper === "unreachable" && state === "online"
        ? { online: 3, max: 20, names: ["Marlene_B", "TheRedstoneKid", "ikarus_77"], sampled: false }
        : null,
    reason: null,
    checkedAt: NOW,
  };
}

function fakeServer(id = "smp", state = "online", wrapper: "up" | "unreachable" = "up") {
  return {
    id,
    config: { id, serverDir: "/fake" },
    capabilities: {
      scripts: { start: true, stop: true, restart: true, backup: true, status: true },
      backups: true,
      restore: true,
      modManifest: true,
      variablesFile: true,
    },
    supportsTps: true,
    getTps: vi.fn().mockResolvedValue({ tps1m: 19.8 }),
    getHealth: vi.fn().mockResolvedValue(health(state, wrapper)),
    getList: vi.fn().mockResolvedValue({
      playerCount: "3",
      maxPlayers: "20",
      players: ["Marlene_B", "TheRedstoneKid", "ikarus_77"],
    }),
  };
}

type Execute = (i: never) => Promise<void>;

async function runCommand(
  execute: Execute,
  language: Language,
  options: Parameters<typeof recordingInteraction>[1] = {},
) {
  const { interaction, sent } = recordingInteraction(language, options);
  await execute(interaction as never);
  return sent;
}

async function bothLanguages(
  run: (language: Language) => Promise<unknown>,
): Promise<Record<Language, unknown>> {
  const out = {} as Record<Language, unknown>;
  for (const language of LANGUAGES) out[language] = await run(language);
  return out;
}

describe("Discord snapshots: slash commands", () => {
  it("/status in each server state", async () => {
    const { execute } = await import("../../../src/bot/commands/info/status.js");
    const cases = [
      ["online", "up"],
      ["unresponsive", "up"],
      ["offline", "up"],
      ["unknown", "unreachable"],
      ["online", "unreachable"],
    ] as const;
    vi.mocked(getUptimeStats).mockImplementation(async () => ({
      currentState: "online",
      currentStateDuration: 2 * DAY + 7 * HOUR + 12 * 60_000,
    }) as never);
    const out: Record<string, unknown> = {};
    for (const [state, wrapper] of cases) {
      out[`${state}, wrapper ${wrapper}`] = await bothLanguages(async (language) => {
        vi.mocked(resolveServer).mockReturnValue(fakeServer("smp", state, wrapper) as never);
        return runCommand(execute as Execute, language, { commandName: "status" });
      });
    }
    recordControlAction("smp", { kind: "stop", by: "marlene", byId: "admin-2", at: NOW - 98 * 60_000 });
    out["offline, stopped by an admin"] = await bothLanguages(async (language) => {
      vi.mocked(resolveServer).mockReturnValue(fakeServer("smp", "offline") as never);
      return runCommand(execute as Execute, language, { commandName: "status" });
    });
    out["offline, no start script"] = await bothLanguages(async (language) => {
      const server = { ...fakeServer("smp", "offline"), capabilities: null };
      vi.mocked(resolveServer).mockReturnValue(server as never);
      return runCommand(execute as Execute, language, { commandName: "status" });
    });
    await expect(stringify(out)).toMatchFileSnapshot(fixturePath("status"));
  });

  it("/server stop: confirm, denial and the confirmed public notice", async () => {
    const { execute } = await import("../../../src/bot/commands/server/control.js");
    const { handleConfirmInteraction, confirmTarget } = await import(
      "../../../src/bot/interactions/confirmActions.js"
    );
    const { confirmCustomId } = await import("../../../src/bot/utils/embeds/confirm.js");
    const serverModule = await import("../../../src/core/utils/server/server.js");
    const server = fakeServer();
    vi.mocked(resolveServer).mockReturnValue(server as never);
    vi.spyOn(serverModule, "getServerInstance").mockReturnValue(server as never);
    vi.mocked(serverAccess.runScript).mockResolvedValue({
      exitCode: 0,
      output: "",
      stderr: "",
    } as never);

    const out = {
      confirm: await bothLanguages((language) =>
        runCommand(execute as Execute, language, { commandName: "server", subcommand: "stop" }),
      ),
      denied: await bothLanguages((language) =>
        runCommand(execute as Execute, language, {
          commandName: "server",
          subcommand: "stop",
          admin: false,
        }),
      ),
      confirmed: await bothLanguages(async (language) => {
        const sent: Array<Record<string, unknown>> = [];
        const button = {
          customId: confirmCustomId("yes", confirmTarget("server-stop", "smp", "admin-1")),
          user: { id: "admin-1", tag: "domenic", username: "domenic" },
          member: null,
          guild: { id: GUILD[language] },
          isButton: () => true,
          update: async (p: unknown) => void sent.push(renderMessage("update", p)),
          followUp: async (p: unknown) => {
            sent.push(renderMessage("followUp", p));
            return { id: "notice" };
          },
          reply: async (p: unknown) => void sent.push(renderMessage("reply", p)),
          webhook: {
            editMessage: async (_m: unknown, p: unknown) =>
              void sent.push(renderMessage("webhook.editMessage", p)),
          },
        };
        await handleConfirmInteraction(button as never);
        return sent;
      }),
    };
    await expect(stringify(out)).toMatchFileSnapshot(fixturePath("server-stop"));
  });

  it("errors: an unreachable wrapper and an unexpected throw", async () => {
    const { execute } = await import("../../../src/bot/commands/stats/players.js");
    vi.mocked(resolveServer).mockReturnValue(fakeServer() as never);
    const out = {
      "players, wrapper unreachable": await bothLanguages(async (language) => {
        vi.mocked(loadAllStats).mockRejectedValueOnce(new TypeError("fetch failed"));
        return runCommand(execute as Execute, language, { commandName: "players" });
      }),
      "players, non-Error thrown": await bothLanguages(async (language) => {
        vi.mocked(loadAllStats).mockRejectedValueOnce({});
        return runCommand(execute as Execute, language, { commandName: "players" });
      }),
    };
    await expect(stringify(out)).toMatchFileSnapshot(fixturePath("errors"));
  });

  it("/players page 1 of a 41 player roster, live and after the pager timed out", async () => {
    const { buildPages } = await import("../../../src/bot/commands/stats/players.js");
    const { createPaginationButtons } = await import(
      "../../../src/bot/utils/embeds/embedUtils.js"
    );
    const named = [
      ["Marlene_B", true, 212],
      ["TheRedstoneKid", true, 188],
      ["ikarus_77", true, 164],
      ["creeperchen", 2 * DAY, 131],
      ["Tobi2k", 4 * DAY, 97],
      ["Nils_Builds", HOUR, 54],
      ["Lena_Fox", 6 * DAY, 49],
      ["kartoffel_pro", 11 * DAY, 33],
    ] as const;
    const roster = [
      ...named.map(([name, seen, hours]) => ({
        uuid: null,
        name,
        online: seen === true,
        lastSeen: seen === true ? null : NOW - (seen as number),
        playtimeTicks: hours * 72_000,
      })),
      ...Array.from({ length: 33 }, (_, i) => ({
        uuid: null,
        name: `player_${String(i + 1).padStart(2, "0")}`,
        online: false,
        lastSeen: i % 4 === 0 ? null : NOW - (i + 12) * DAY,
        playtimeTicks: (30 - Math.min(i, 29)) * 72_000,
      })),
    ];
    const out = await bothLanguages(async (language) =>
      runWithGuildLocale(GUILD[language], () => {
        const pages = buildPages(roster, "smp");
        return {
          pages: pages.length,
          page1: renderEmbed(pages[0]),
          pager: renderRow(createPaginationButtons(0, pages.length)),
          pagerTimedOut: renderRow(createPaginationButtons(0, pages.length, { disabled: true })),
        };
      }),
    );
    await expect(stringify(out)).toMatchFileSnapshot(fixturePath("players"));
  });

  it("/mods for a 62 mod pack", async () => {
    const { execute } = await import("../../../src/bot/commands/info/mods.js");
    vi.mocked(resolveServer).mockReturnValue(fakeServer() as never);
    const mod = (name: string) => ({
      slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      name,
      description: "",
      url: `https://modrinth.com/mod/${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      side: "both",
    });
    const both = [
      "Create",
      "Create Deco",
      "Fabric API",
      "Farmer's Delight Refabricated",
      "Supplementaries",
      "Terralith",
      "Waystones",
      ...Array.from({ length: 34 }, (_, i) => `Content Mod ${i + 1}`),
    ].map(mod);
    const optional = [
      "Iris Shaders",
      "Sodium",
      "Xaero's Minimap",
      "Xaero's World Map",
      ...Array.from({ length: 7 }, (_, i) => `Client Mod ${i + 1}`),
    ].map(mod);
    const serverOnly = Array.from({ length: 10 }, (_, i) => mod(`Server Mod ${i + 1}`));
    vi.mocked(getModList).mockResolvedValue({
      clientAndServer: both,
      clientOptional: optional,
      serverOnly,
      fetchedAt: NOW,
    } as never);
    const out = await bothLanguages((language) =>
      runCommand(execute as Execute, language, { commandName: "mods" }),
    );
    await expect(stringify(out)).toMatchFileSnapshot(fixturePath("mods"));
  });

  it("/backup with five backup types", async () => {
    const { execute } = await import("../../../src/bot/commands/server/backup.js");
    vi.mocked(resolveServer).mockReturnValue(fakeServer() as never);
    const GB = 1_073_741_824;
    vi.mocked(serverAccess.readBackups).mockResolvedValue({
      dirs: [
        { dir: "hourly", count: 3, latestSizeBytes: 3.81 * GB, latestMtime: new Date(NOW - 35 * 60_000) },
        { dir: "daily", count: 7, latestSizeBytes: 3.78 * GB, latestMtime: new Date(NOW - 11 * HOUR) },
        { dir: "update", count: 2, latestSizeBytes: 3.65 * GB, latestMtime: new Date(NOW - 2 * DAY) },
        { dir: "manual", count: 1, latestSizeBytes: 3.55 * GB, latestMtime: new Date(NOW - 5 * DAY) },
        { dir: "archives/archive", count: 5, latestSizeBytes: 3.4 * GB, latestMtime: new Date(NOW - 6 * DAY) },
      ],
      totalBytes: 61.2 * GB,
    } as never);
    const out = await bothLanguages((language) =>
      runCommand(execute as Execute, language, { commandName: "backup" }),
    );
    await expect(stringify(out)).toMatchFileSnapshot(fixturePath("backup"));
  });
});
