/**
 * Shared bits for alert senders (downtime, TPS, host/disk, backup age).
 *
 * `mentionRole` on an alert block turns a silent embed into one the
 * on-call person actually sees. allowedMentions is pinned to exactly the
 * configured role so an alert can never ping @everyone or unrelated roles
 * even if a future refactor interpolates other content.
 */

export interface AlertMention {
  content?: string;
  allowedMentions?: { roles: string[] };
}

/** Message fields that ping the configured role, or nothing when unset. */
export function roleMention(mentionRole: string | undefined): AlertMention {
  if (!mentionRole) return {};
  return {
    content: `<@&${mentionRole}>`,
    allowedMentions: { roles: [mentionRole] },
  };
}
