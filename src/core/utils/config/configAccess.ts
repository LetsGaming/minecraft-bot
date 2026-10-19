/**
 * Reading the loaded config from code that must keep running without it.
 *
 * Lives beside `config.ts` rather than inside it so a caller imports only the
 * tolerant reader, and the decision to fail open or closed is made visible at
 * each call site instead of hiding in an empty `catch`.
 */
import { loadConfig } from "../../config.js";
import type { BotConfig } from "../../types/index.js";
import { errMsg } from "../error.js";
import { log } from "../logger.js";

export type ConfigLoadResult =
  | { ok: true; config: BotConfig }
  | { ok: false; error: string; failOpen: boolean };

let lastLoadFailure: string | null = null;

/**
 * loadConfig() for callers that must keep running when the config cannot be
 * read. The caller states which way a failure resolves: `"open"` (carry on as
 * if nothing was restricted) or `"closed"` (refuse). The result carries that
 * as `failOpen`.
 *
 * A failure is logged once; the same failure repeating stays quiet until a
 * load succeeds or the message changes.
 */
export function tryLoadConfig(opts: { onError: "open" | "closed" }): ConfigLoadResult {
  try {
    const config = loadConfig();
    lastLoadFailure = null;
    return { ok: true, config };
  } catch (err) {
    const error = errMsg(err);
    if (error !== lastLoadFailure) {
      lastLoadFailure = error;
      log.warn("config", `Config could not be loaded (failing ${opts.onError}): ${error}`);
    }
    return { ok: false, error, failOpen: opts.onError === "open" };
  }
}
