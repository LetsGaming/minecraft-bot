/**
 * The wrapper's wire types under the names the bot uses.
 *
 * types.ts is generated from the wrapper's OpenAPI document and always
 * describes the newest wrapper. The bot also talks to older wrappers (it
 * negotiates by manifest feature version), so a field a newer feature added
 * is declared optional here and callers keep treating its absence as the old
 * behaviour.
 */
import type { components } from "./types.js";

export type { components, operations, paths } from "./types.js";

export type WireSchemas = components["schemas"];

type Wire = WireSchemas;

export type ScriptResult = Wire["ScriptResult"];
export type BackupFileInfo = Wire["BackupFileInfo"];
export type BackupFileIndexBody = Wire["BackupFileIndex"];
export type BackupDirInfo = Wire["BackupDirInfo"];
export type BackupSummaryBody = Wire["BackupSummary"];
export type ConfigFileInfo = Wire["ConfigFileInfo"];

/** `enabled` arrived with mod-management v2; absent means active. */
export type InstalledMod = Omit<Wire["InstalledMod"], "enabled"> & {
  enabled?: boolean;
};

export interface InstalledMods extends Omit<Wire["InstalledMods"], "mods"> {
  mods: InstalledMod[];
}

export type ModToggleResult = Wire["ModToggleResult"];
export type ModAddResult = Wire["ModAddResult"];
export type ModRemoveResult = Wire["ModRemoveResult"];
export type ModUpdateCheck = Wire["ModUpdateCheck"];
export type ModApplyResult = Wire["ModApplyResult"];
export type ModCompatJob = Wire["ModCompatJob"];
export type ModCompatMod = Wire["ModCompatMod"];
export type ModCompatStarted = Wire["ModCompatStarted"];

export type UpgradeRequest = Wire["UpgradeRequest"];
export type UpgradeStarted = Wire["UpgradeStarted"];
export type UpgradeJob = Wire["UpgradeJob"];
export type UpgradeEvent = Wire["UpgradeJob"]["events"][number];
export type UpgradeResult = NonNullable<Wire["UpgradeJob"]["result"]>;
export type LifecycleEventsBody = Wire["LifecycleEvents"];

export type PruneParams = Wire["PruneParams"];
export type PruneParamsRequest = Wire["PruneParamsRequest"];
export type PruneZone = Wire["PruneZone"];
export type PruneSummary = Wire["PruneSummary"];
export type PruneDimensionSummary = Wire["PruneDimensionSummary"];
export type PruneScanJob = Wire["PruneScanJob"];
export type PruneScanStarted = Wire["PruneScanStarted"];
export type PruneMap = Wire["PruneMap"];

/** A 404 answers `{ ok: false }` alone; the rest is the wrapper's body. */
export type BackupDeleteResult = Pick<Wire["BackupFileDeleted"], "ok"> &
  Partial<Wire["BackupFileDeleted"]>;

/**
 * The `host` block of the wrapper's /info, as any wrapper age may send it:
 * host-info v1 sent `process` and a flat `disks`, v2 adds the whole-machine
 * `host` block and moves the filesystem figures under `disks[].filesystem`
 * next to a per-directory `sizeBytes`. hostResources normalises both.
 */
export interface RemoteHostInfo {
  process?: Wire["HostInfo"]["process"];
  host?: Wire["HostInfo"]["host"];
  disks?: Array<
    Pick<Wire["DiskUsage"], "path"> &
      Partial<Omit<Wire["DiskUsage"], "path">> & {
        usedPercent?: number;
        availableBytes?: number;
        totalBytes?: number;
      }
  >;
}
