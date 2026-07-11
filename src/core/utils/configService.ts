/**
 * Programmatic config editing — the layer a future WebUI talks to instead
 * of hand-editing config.json.
 *
 *   readRawConfig()     raw on-disk JSON (secrets included; the HTTP layer
 *                       must redact)
 *   validateCandidate() collect every error/warning instead of throwing
 *   writeConfig()       validate, then replace config.json atomically
 *
 * applyConfig() — reload + reconcile the RUNNING bot's instances — lives in
 * src/bot/utils/applyConfig.ts: it calls into the Discord process and is
 * therefore bot-only. The web backend never applies; it writes through
 * writeConfig() and the bot's fs watcher picks the change up (or, with the
 * bot down, the change applies on its next start).
 *
 * See docs/dev/webui-integration.md for the HTTP wiring.
 */
import fs from "fs";
import { promises as fsPromises } from "fs";
import { createHash } from "crypto";
import {
  getConfigPath,
  validateCandidateConfig,
  type ConfigValidationResult,
} from "../config.js";
import { log } from "./logger.js";
import { snapshotConfig, type SnapshotMeta } from "./configHistory.js";
import type { RawBotConfig } from "../types/index.js";

/** Raw on-disk config (no env overrides, no variables.txt resolution). */
export function readRawConfig(): RawBotConfig {
  return JSON.parse(
    fs.readFileSync(getConfigPath(), "utf-8"),
  ) as RawBotConfig;
}

/**
 * sha256 of the on-disk config.json bytes — the optimistic-concurrency
 * token for dashboard edits. Editors GET it, send it back with their PUT,
 * and a mismatch means someone (a second admin, the bot's /config command,
 * a hand edit) changed the file underneath them: reject with 409 instead
 * of silently clobbering.
 */
export function configFileHash(): string {
  return createHash("sha256")
    .update(fs.readFileSync(getConfigPath(), "utf-8"))
    .digest("hex");
}

/** Validate a candidate config object without touching disk. */
export function validateCandidate(
  candidate: unknown,
): ConfigValidationResult {
  return validateCandidateConfig(candidate);
}

/**
 * Validate and atomically write a new config.json.
 *
 * @throws {Error} listing every validation error when the candidate is
 *                 invalid — nothing is written in that case.
 * @returns validation warnings (non-fatal issues worth surfacing in a UI).
 */
export async function writeConfig(
  candidate: RawBotConfig,
  meta?: SnapshotMeta,
): Promise<{ warnings: string[] }> {
  const result = validateCandidateConfig(candidate);
  if (!result.valid) {
    throw new Error(
      `Refusing to write invalid config:\n${result.errors.join("\n")}`,
    );
  }

  const configPath = getConfigPath();
  const json = JSON.stringify(candidate, null, 2) + "\n";

  // Read the config we're about to replace, for rollback history.
  let previous: string | null = null;
  try {
    previous = await fsPromises.readFile(configPath, "utf-8");
  } catch {
    // no existing config yet — nothing to snapshot
  }

  // Write-then-rename so a crash can never leave a truncated config.json.
  // This requires the config to live on a writable, process-owned path on a
  // single filesystem — in Docker the data/ volume (see MCBOT_CONFIG_PATH).
  // A raw EACCES/EROFS/EXDEV here (e.g. a root-owned dir or a read-only
  // single-file bind mount) would otherwise surface to the dashboard as an
  // opaque 500, so map it to an actionable message and don't leave a stray
  // temp file behind.
  const tmp = `${configPath}.tmp`;
  try {
    await fsPromises.writeFile(tmp, json);
    try {
      await fsPromises.copyFile(configPath, `${configPath}.bak`);
    } catch {
      // no existing config yet — nothing to back up
    }
    await fsPromises.rename(tmp, configPath);
  } catch (err) {
    await fsPromises.rm(tmp, { force: true }).catch(() => {});
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to write config to ${configPath}: ${reason}. The config must ` +
        `live on a writable path owned by the bot (in Docker, the data/ ` +
        `volume — set MCBOT_CONFIG_PATH); a read-only mount cannot be edited ` +
        `from the dashboard.`,
    );
  }

  // Record the replaced config into rollback history (best-effort — never
  // fails the write). Skipped on the first write (no previous config).
  if (previous !== null) snapshotConfig(previous, meta);

  log.info("config", `config.json updated programmatically (${configPath})`);
  return { warnings: result.warnings };
}
