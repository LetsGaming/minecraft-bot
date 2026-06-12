/**
 * F-05: German locale. Keys missing here fall back to English per key.
 */
export const de: Record<string, string> = {
  // ── common ──
  "common.serverNotFound": "Server nicht gefunden.",
  "common.noPermission": "Du hast keine Berechtigung für diesen Befehl.",
  "common.invalidUsername":
    "**{username}** ist kein gültiger Minecraft-Benutzername.",

  // ── whois (F-01) ──
  "whois.title": "Whois — {username}",
  "whois.noData":
    "Keine Whitelist- oder Link-Daten für **{username}** gefunden.",
  "whois.addedBy": "Hinzugefügt von",
  "whois.addedAt": "Hinzugefügt am",
  "whois.server": "Server",
  "whois.uuid": "UUID",
  "whois.removedBy": "Entfernt von",
  "whois.removedAt": "Entfernt am",
  "whois.linkedAccount": "Verknüpfter Discord-Account",
  "whois.notLinked": "Nicht verknüpft",

  // ── daily reminders (F-04) ──
  "dailyReminder.enabled":
    "✅ Tägliche Erinnerungen aktiviert — ich schicke dir eine DM, sobald dein nächstes /daily bereit ist. Stelle sicher, dass deine DMs für diesen Server offen sind.",
  "dailyReminder.disabled": "✅ Tägliche Erinnerungen deaktiviert.",
  "dailyReminder.dm":
    "🎁 Deine tägliche Belohnung ist bereit! Hol sie dir mit /daily auf dem Server ab.",
};
