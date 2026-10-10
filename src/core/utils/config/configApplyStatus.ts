import fs from "fs";
import { getConfigPath } from "../../config.js";
import { heartbeatIsFresh, type RuntimeHeartbeat } from "../server/runtimeHeartbeat.js";
import { ConfigApplyState, type ConfigStatusResponse } from "@mcbot/schema";

/**
 * Compare the file on disk with what the bot last reported applying.
 *
 * A stale heartbeat wins over everything: with the bot down nothing is being
 * applied, whatever the last report said.
 */
export function computeConfigStatus(
  revision: { hash: string; at: number },
  beat: RuntimeHeartbeat | null,
  now = Date.now(),
): ConfigStatusResponse {
  const botAlive = heartbeatIsFresh(beat, now);
  const applied = beat?.config
    ? { hash: beat.config.hash, at: beat.config.appliedAt }
    : null;
  const restartRequired = beat?.config?.restartRequired ?? [];

  let state: ConfigStatusResponse["state"];
  if (!botAlive) state = ConfigApplyState.BotDown;
  else if (!applied) state = ConfigApplyState.Unknown;
  else if (applied.hash !== revision.hash) state = ConfigApplyState.Pending;
  else if (restartRequired.length > 0) state = ConfigApplyState.RestartRequired;
  else state = ConfigApplyState.Applied;

  return { state, revision, applied, restartRequired, botAlive };
}

/** Hash and modification time of the config.json currently on disk. */
export function readConfigRevision(hash: string): { hash: string; at: number } {
  return { hash, at: Math.floor(fs.statSync(getConfigPath()).mtimeMs) };
}
