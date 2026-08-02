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

/**
 * One archive in the backups directory (wrapper >= 3.3.0).
 *
 * `id` is an opaque handle from the wrapper's index and is the ONLY file
 * reference any client sends back. Nothing here or in the browser ever names
 * a path, which is why traversal is not something this layer defends against.
 */
export interface BackupFileInfo {
  id: string;
  tier: string;
  name: string;
  sizeBytes: number;
  mtimeMs: number;
}

export interface BackupFileIndex {
  files: BackupFileInfo[];
  /** Pass back as `cursor`. Null when the listing is complete. */
  nextCursor: string | null;
  total: number;
}

export interface ScriptResult {
  output: string;
  stderr: string;
  exitCode: number | null;
}
