/**
 * M-13 (stage 2): runtime capability detection.
 *
 * The bot is designed for servers installed via the minecraft-server-setup
 * suite, but works against plain servers for everything that doesn't depend
 * on suite artifacts. These flags record, per server instance, which suite
 * artifacts were actually found — so missing pieces surface as clear
 * feature gaps instead of raw ENOENT errors at invocation time.
 */
export interface ScriptCapabilities {
  start: boolean;
  stop: boolean;
  restart: boolean;
  backup: boolean;
  status: boolean;
}

export interface ServerCapabilities {
  /** Management scripts under {scriptDir} (start.sh, shutdown.sh, ...). */
  scripts: ScriptCapabilities;
  /** Suite backup directory layout next to serverDir. */
  backups: boolean;
  /** {scriptDir}/common/downloaded_versions.json (powers /mods). */
  modManifest: boolean;
  /** {scriptDir}/common/variables.txt (config override source). */
  variablesFile: boolean;
}

/** Conservative default: assume everything is available (legacy behaviour). */
export function allCapabilities(): ServerCapabilities {
  return {
    scripts: {
      start: true,
      stop: true,
      restart: true,
      backup: true,
      status: true,
    },
    backups: true,
    modManifest: true,
    variablesFile: true,
  };
}
