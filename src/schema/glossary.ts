import type { StatusRole } from "./status.js";

export type GlossaryLanguage = "en" | "de";

export interface GlossaryEntry {
  en: string;
  de: string;
}

/**
 * Terms the bot and the dashboard must name identically. Keys are
 * `<area>.<name>`; German follows the bot's locale files.
 */
export const GLOSSARY = {
  "term.server": { en: "Server", de: "Server" },
  "term.guild": { en: "Guild", de: "Gilde" },
  "term.mod": { en: "Mod", de: "Mod" },
  "term.player": { en: "Player", de: "Spieler" },
  "term.backup": { en: "Backup", de: "Backup" },

  "status.online": { en: "Online", de: "Online" },
  "status.degraded": { en: "Not responding", de: "Antwortet nicht" },
  "status.offline": { en: "Offline", de: "Offline" },
  "status.unknown": { en: "Unknown", de: "Unbekannt" },
  "status.pending": { en: "Pending", de: "Ausstehend" },
  "status.applied": { en: "Applied", de: "Angewendet" },
  "status.info": { en: "Working", de: "In Arbeit" },

  "apply.applied": { en: "Applied", de: "Angewendet" },
  "apply.pending": { en: "Waiting for the bot", de: "Wartet auf den Bot" },
  "apply.botDown": { en: "Bot is not running", de: "Bot läuft nicht" },
  "apply.restartRequired": { en: "Restart required", de: "Neustart erforderlich" },
  "apply.unknown": { en: "Not reported", de: "Nicht gemeldet" },
} as const satisfies Record<string, GlossaryEntry>;

export type GlossaryKey = keyof typeof GLOSSARY;

export function glossaryText(key: GlossaryKey, language: GlossaryLanguage = "en"): string {
  return GLOSSARY[key][language];
}

/** The glossary key of the label for a status role. */
export function statusRoleGlossaryKey(role: StatusRole): GlossaryKey {
  return `status.${role}`;
}
