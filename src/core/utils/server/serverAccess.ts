/**
 * Public entry point for every call to the remote API wrapper.
 *
 * The implementation lives by feature under ./access/; this barrel keeps the
 * set of names callers (and `vi.mock` in tests) depend on in one place.
 */

export { RateLimitedError } from "./access/apiClient.js";
export {
  forgetGamePort,
  rememberGamePort,
  pingTarget,
  pingServer,
  getHealth,
  isRunning,
  getList,
  getTps,
} from "./access/health.js";
export { sendCommandOutcome } from "./access/commands.js";
export { getRemoteInfo, versionAtLeast } from "./access/host.js";
export type { RemoteInfo } from "./access/host.js";
export { getRemoteManifest, verifyWrapperContract } from "./access/manifest.js";
export { readWhitelist, readUserCache } from "./access/players.js";
export {
  readLevelName,
  readStats,
  listStatsUuids,
  readAllStats,
  deleteStatsFile,
} from "./access/stats.js";
export {
  readModSlugs,
  listInstalledMods,
  addMod,
  removeMod,
  checkModUpdates,
  applyModUpdates,
  updateMod,
  disableMod,
  enableMod,
} from "./access/mods.js";
export { supportsModCompat, startModCompat, getModCompat } from "./access/modCompat.js";
export {
  supportsUpgrade,
  supportsLifecycleEvents,
  startUpgrade,
  getUpgrade,
  getCurrentUpgrade,
  readLifecycleEvents,
} from "./access/upgrade.js";
export {
  supportsPrune,
  startPruneScan,
  getPruneScan,
  getPruneDimensions,
  getPruneStatus,
  cancelPruneScan,
  getPruneSettings,
  setPruneSettings,
  getPruneMap,
  getPruneChunk,
  startPrune,
} from "./access/prune.js";
export {
  readBackups,
  indexBackupFiles,
  openBackupDownload,
  restoreBackupFile,
  deleteBackupFile,
} from "./access/backups.js";
export {
  indexConfigFiles,
  readConfigFile,
  writeConfigFile,
  revertConfigFile,
} from "./access/configFiles.js";
export type {
  ConfigFileContents,
  ConfigIndexResult,
  ConfigFileInfo,
} from "./access/configFiles.js";
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
} from "@mcbot/schema/wire/index.js";

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
