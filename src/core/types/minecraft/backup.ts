// ── Backup types ─────────────────────────────────────────────────────────────

export interface BackupDirInfo {
  dir: string;
  count: number;
  latestFile: string;
  latestMtime: Date;
  latestSizeBytes: number;
}

export interface BackupSummary {
  dirs: BackupDirInfo[];
  totalBytes: number;
}

// Declared in @mcbot/schema because the browser reads them too; re-exported
// here so core's own callers keep importing backup shapes from one place.
export type { BackupFileInfo, BackupFileIndex } from "@mcbot/schema/contract.js";

export interface ScriptResult {
  output: string;
  stderr: string;
  exitCode: number | null;
}
