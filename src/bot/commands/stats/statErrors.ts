import { CommandError } from "@mcbot/core/utils/error.js";
import { t } from "@mcbot/core/utils/i18n.js";
import { loadStats } from "@mcbot/core/utils/minecraft/statUtils.js";
import type { MinecraftStatsFile } from "@mcbot/core/types/index.js";
import type { ServerInstance } from "@mcbot/core/utils/server/server.js";
import { loadOrFail } from "../shared/loadOrFail.js";

export function playerNotFound(player: string): CommandError {
  return new CommandError({
    title: t("common.playerNotFoundTitle"),
    problem: t("common.playerNotFound", { player }),
    recovery: t("common.playerNotFoundRecovery"),
  });
}

export function noStatsYet(player: string): CommandError {
  return new CommandError({
    title: t("stats.noStatsTitle"),
    problem: t("stats.fileNotFound", { player }),
    recovery: t("stats.fileNotFoundRecovery"),
  });
}

/** One player's stats file; a read failure becomes a friendly error instead of a raw I/O message. */
export function loadStatsOrFail(uuid: string, server: ServerInstance): Promise<MinecraftStatsFile | null> {
  return loadOrFail("stats", t("stats.failed"), () => loadStats(uuid, server));
}
