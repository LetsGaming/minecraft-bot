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
  "term.guild": { en: "Guild", de: "Discord-Server" },
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

  "tier.hourly": { en: "Hourly", de: "Stündlich" },
  "tier.daily": { en: "Daily", de: "Täglich" },
  "tier.weekly": { en: "Weekly", de: "Wöchentlich" },
  "tier.monthly": { en: "Monthly", de: "Monatlich" },
  "tier.update": { en: "Pre-update", de: "Vor Update" },
  "tier.manual": { en: "Manual", de: "Manuell" },
  "tier.archive": { en: "Archive", de: "Archiv" },
} as const satisfies Record<string, GlossaryEntry>;

export type GlossaryKey = keyof typeof GLOSSARY;

/**
 * The label of a backup tier directory as the wrapper files it ("hourly",
 * "archives/daily", "archives/update"). An unknown leaf comes back
 * capitalised, so a new tier still reads as a word.
 */
export function backupTierLabel(dir: string, language: GlossaryLanguage = "en"): string {
  const leaf = dir.split("/").pop() ?? dir;
  const key = `tier.${leaf.toLowerCase()}`;
  if (key in GLOSSARY) return GLOSSARY[key as GlossaryKey][language];
  return leaf.charAt(0).toUpperCase() + leaf.slice(1);
}
