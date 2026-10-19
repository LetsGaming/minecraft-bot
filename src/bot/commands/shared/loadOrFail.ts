import { log } from "@mcbot/core/utils/logger.js";
import { CommandError, errMsg } from "@mcbot/core/utils/error.js";
import { t } from "@mcbot/core/utils/i18n.js";
import {
  classifyTransportError,
  classifyWrapperRejection,
} from "@mcbot/core/utils/server/transportError.js";

/**
 * Runs a read and turns an unexpected failure (a file error, say) into a
 * friendly one: the cause is logged and the user sees `problem` instead of a
 * raw I/O message. Failures reaching the wrapper keep their own, more specific
 * reply from the error middleware.
 */
export async function loadOrFail<T>(
  tag: string,
  problem: string,
  load: () => Promise<T>,
): Promise<T> {
  try {
    return await load();
  } catch (err) {
    if (
      err instanceof CommandError ||
      classifyTransportError(err) ||
      classifyWrapperRejection(err)
    ) {
      throw err;
    }
    log.error(tag, errMsg(err));
    throw new CommandError({ problem, recovery: t("common.retryLater") });
  }
}
