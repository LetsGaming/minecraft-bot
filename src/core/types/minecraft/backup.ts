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

export interface ScriptResult {
  output: string;
  stderr: string;
  exitCode: number | null;
}
