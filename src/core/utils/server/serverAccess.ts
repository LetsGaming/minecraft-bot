/**
 * serverAccess.ts
 *
 * Single routing layer for every operation that requires either local
 * filesystem / shell access OR a call to the remote API wrapper.
 *
 * Rule: if server.config.apiUrl is set → HTTP call to the API wrapper.
 *       Otherwise → exact same local logic that always existed.
 *
 * Callers never import fs, path, spawn, or execFile directly for
 * server-specific data. They import and call these functions instead.
 *
 * Functions are intentionally thin — they do no business logic beyond
 * routing and returning the raw data the caller needs.
 */

import type {
  BackupDeleteResult,
  InstalledMod,
  InstalledMods,
  ModAddResult,
  ModApplyResult,
  ModCompatJob,
  ModCompatMod,
  ModCompatStarted,
  ModRemoveResult,
  ModToggleResult,
  ModUpdateCheck,
  RemoteHostInfo,
} from "@mcbot/schema/wire/index.js";

export { RateLimitedError } from "./access/apiClient.js";
export { forgetGamePort, rememberGamePort, pingTarget, pingServer, getHealth, isRunning, getList, getTps } from "./access/health.js";
export { sendCommandOutcome } from "./access/commands.js";
export { getRemoteInfo, versionAtLeast } from "./access/host.js";
export type { RemoteInfo } from "./access/host.js";
export { getRemoteManifest, verifyWrapperContract } from "./access/manifest.js";
export { readWhitelist, readUserCache } from "./access/players.js";
export { readLevelName, readStats, listStatsUuids, readAllStats, deleteStatsFile } from "./access/stats.js";
export { readModSlugs, listInstalledMods, addMod, removeMod, checkModUpdates, applyModUpdates, updateMod, disableMod, enableMod } from "./access/mods.js";
export { supportsModCompat, startModCompat, getModCompat } from "./access/modCompat.js";
export { readBackups, indexBackupFiles, openBackupDownload, restoreBackupFile, deleteBackupFile } from "./access/backups.js";
export { indexConfigFiles, readConfigFile, writeConfigFile, revertConfigFile } from "./access/configFiles.js";
export type { ConfigFileContents, ConfigIndexResult, ConfigFileInfo } from "./access/configFiles.js";
export { detectCapabilities } from "./access/capabilityProbe.js";
export { runScript, ScriptStillRunningError } from "./access/scripts.js";
export { tailLog, logStreamUrl, openLogStream } from "./access/logs.js";
export type { LogStreamHandlers } from "./access/logs.js";

export type {
  BackupDeleteResult,
  InstalledMod,
  InstalledMods,
  ModAddResult,
  ModApplyResult,
  ModCompatJob,
  ModCompatMod,
  ModCompatStarted,
  ModRemoveResult,
  ModToggleResult,
  ModUpdateCheck,
  RemoteHostInfo,
};

// ── Wrapper /info: version handshake + remote host metrics ───────────────

// The expected-feature table, the manifest parser, and the report live in
// wrapperContract.ts; re-exported here so the wrapper contract still has
// one entry point for callers.
export {
  MIN_WRAPPER_VERSION,
  EXPECTED_WRAPPER_FEATURES,
  SUPPORTED_MANIFEST_VERSION,
  compareContract,
  describeContract,
  contractIsClean,
  parseManifest,
  type WrapperManifest,
  type ContractReport,
} from "./wrapperContract.js";
