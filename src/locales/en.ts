/**
 * F-05: English locale (default + fallback).
 *
 * Key convention: `<area>.<message>` in camelCase. Placeholders use
 * {curlyBraces} and are substituted by t() — see utils/i18n.ts.
 *
 * Migration note: existing commands still carry literal English strings;
 * NEW user-visible strings go through t() from day one, and literals can
 * be migrated key-by-key whenever a command is touched. Adding a key here
 * without a German counterpart is fine — de falls back to en per key.
 */
export const en: Record<string, string> = {
  // ── common ──
  "common.serverNotFound": "Server not found.",
  "common.noPermission": "You do not have permission to use this command.",
  "common.invalidUsername": "**{username}** is not a valid Minecraft username.",

  // ── whois (F-01) ──
  "whois.title": "Whois — {username}",
  "whois.noData": "No whitelist or link data found for **{username}**.",
  "whois.addedBy": "Added by",
  "whois.addedAt": "Added at",
  "whois.server": "Server",
  "whois.uuid": "UUID",
  "whois.removedBy": "Removed by",
  "whois.removedAt": "Removed at",
  "whois.linkedAccount": "Linked Discord account",
  "whois.notLinked": "Not linked",

  // ── daily reminders (F-04) ──
  "dailyReminder.enabled":
    "✅ Daily reminders enabled — I'll DM you when your next /daily is ready. Make sure your DMs are open for this server.",
  "dailyReminder.disabled": "✅ Daily reminders disabled.",
  "dailyReminder.dm":
    "🎁 Your daily reward is ready! Claim it with /daily on the server.",
};
