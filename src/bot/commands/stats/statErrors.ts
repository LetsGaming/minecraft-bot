import { CommandError } from "@mcbot/core/utils/error.js";
import { t } from "@mcbot/core/utils/i18n.js";

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
