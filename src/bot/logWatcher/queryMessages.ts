import { t } from "@mcbot/core/utils/i18n.js";
import type { QueryFailure } from "@mcbot/core/utils/server/queryResult.js";

/**
 * What to tell a player when a live server query failed: a server that could
 * not be reached gets its own message, anything else the command's specific one.
 */
export function queryFailureText(
  reason: QueryFailure,
  specificKey: string,
): string {
  return reason === "unreachable" ? t("query.unreachable") : t(specificKey);
}
