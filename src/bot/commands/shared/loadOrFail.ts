import { log } from "@mcbot/core/utils/logger.js";
import { CommandError, errMsg } from "@mcbot/core/utils/error.js";
import { t } from "@mcbot/core/utils/i18n.js";

/**
 * Runs a read and turns any failure into a friendly error: the cause is
 * logged, and the user sees `problem` instead of a raw I/O message.
 */
export async function loadOrFail<T>(
  tag: string,
  problem: string,
  load: () => Promise<T>,
): Promise<T> {
  try {
    return await load();
  } catch (err) {
    log.error(tag, errMsg(err));
    throw new CommandError({ problem, recovery: t("common.retryLater") });
  }
}
