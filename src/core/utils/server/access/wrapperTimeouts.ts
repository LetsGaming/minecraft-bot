import { MS } from "@mcbot/schema/time.js";

/**
 * How long the bot waits for each kind of wrapper request. Where the wrapper
 * bounds the work itself, the figure is that bound plus a margin, so the
 * wrapper's own error reply arrives before the bot gives up.
 */
export const WRAPPER_TIMEOUTS_MS = {
  /** Default for plain reads, deletes and the manifest: a hung wrapper must not stall a poll loop. */
  read: 8 * MS.second,
  /** Health is polled on a loop and the wrapper's probes are bounded well below this. */
  health: 5 * MS.second,
  /** Default for writes that finish quickly: config saves, backup deletes, small POSTs. */
  mutate: 30 * MS.second,
  /** A console command, RCON round trip included. */
  command: 20 * MS.second,
  /** Wait for the response headers of a backup download; the body is unbounded. */
  backupDownloadHeaders: 30 * MS.second,
  /** The wrapper's restore ceiling (600 s) plus a margin. */
  restore: 630 * MS.second,
  /** One chunk of a plan, read fresh. */
  pruneChunk: 30 * MS.second,
  /** A plan's dimension map can be megabytes. */
  pruneMap: 60 * MS.second,
  /** Drawing a region reads all of it; the wrapper allows itself 90 s. */
  pruneTile: 100 * MS.second,
  /** Mod install, single update and the update check: a download or one Modrinth call per mod. */
  modDownload: 130 * MS.second,
  /** Apply every available mod update: downloads each jar. */
  modApplyAll: 610 * MS.second,
} as const;
