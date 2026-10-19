import { log } from "@mcbot/core/utils/logger.js";
import { logSafe } from "@mcbot/core/utils/logSafe.js";
import { MS } from "@mcbot/schema/time.js";

const FLUSH_BUDGET_MS = 3 * MS.second;
const FAULT_LOG_MAX_CHARS = 2000;

function describeFault(fault: unknown): string {
  return logSafe(
    fault instanceof Error ? (fault.stack ?? fault.message) : fault,
    FAULT_LOG_MAX_CHARS,
  );
}

/**
 * Last-resort handlers: log the fault (neutralized) and exit non-zero so the
 * supervisor restarts the bot with a reason on record, instead of the process
 * limping on in an unknown state or dying silently.
 */
export function installProcessGuards(
  flush: () => Promise<void>,
  exit: (code: number) => void = (code) => process.exit(code),
): void {
  let exiting = false;

  const fail = (kind: string, fault: unknown): void => {
    log.error("bot", `${kind}: ${describeFault(fault)}`);
    if (exiting) return;
    exiting = true;
    const timer = setTimeout(() => exit(1), FLUSH_BUDGET_MS);
    timer.unref();
    flush()
      .catch(() => {})
      .finally(() => exit(1));
  };

  process.on("uncaughtException", (err) => fail("Uncaught exception", err));
  process.on("unhandledRejection", (reason) => fail("Unhandled rejection", reason));
}
