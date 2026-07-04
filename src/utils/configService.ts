/**
 * Programmatic config editing — the layer a future WebUI talks to instead
 * of hand-editing config.json.
 *
 *   readRawConfig()     raw on-disk JSON (secrets included; the HTTP layer
 *                       must redact)
 *   validateCandidate() collect every error/warning instead of throwing
 *   writeConfig()       validate, then replace config.json atomically
 *   applyConfig()       reload + reconcile running instances, same path
 *                       as /config reload
 *
 * See docs/dev/webui-integration.md for the intended HTTP wiring.
 */
import fs from "fs";
import { promises as fsPromises } from "fs";
import type { Client } from "discord.js";
import {
  getConfigPath,
  reloadConfig,
  validateCandidateConfig,
  type ConfigValidationResult,
} from "../config.js";
import { reconcileServers } from "../logWatcher/initMinecraftCommands.js";
import { log } from "./logger.js";
import type { BotConfig, RawBotConfig } from "../types/index.js";

/** Raw on-disk config (no env overrides, no variables.txt resolution). */
export function readRawConfig(): RawBotConfig {
  return JSON.parse(
    fs.readFileSync(getConfigPath(), "utf-8"),
  ) as RawBotConfig;
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
): Promise<{ warnings: string[] }> {
  const result = validateCandidateConfig(candidate);
  if (!result.valid) {
    throw new Error(
      `Refusing to write invalid config:\n${result.errors.join("\n")}`,
    );
  }

  const configPath = getConfigPath();
  const json = JSON.stringify(candidate, null, 2) + "\n";

  // Write-then-rename so a crash can never leave a truncated config.json.
  const tmp = `${configPath}.tmp`;
  await fsPromises.writeFile(tmp, json);
  try {
    await fsPromises.copyFile(configPath, `${configPath}.bak`);
  } catch {
    // no existing config yet — nothing to back up
  }
  await fsPromises.rename(tmp, configPath);

  log.info("config", `config.json updated programmatically (${configPath})`);
  return { warnings: result.warnings };
}

/**
 * Reload the config cache and reconcile running server instances and
 * watchers with it — the same path `/config reload` uses. Call after
 * writeConfig() when the bot should apply the change immediately instead
 * of waiting for the fs watcher.
 */
export async function applyConfig(client: Client): Promise<{
  config: BotConfig;
  added: string[];
  removed: string[];
  changed: string[];
}> {
  const config = reloadConfig();
  const { added, removed, changed } = await reconcileServers(client, config);
  return { config, added, removed, changed };
}
