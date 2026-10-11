/**
 * Shared bits for alert senders (downtime, TPS, host/disk, backup age) and
 * for every message that relays text someone else wrote.
 *
 * allowedMentions is always set explicitly: an alert can ping exactly the
 * configured role and nothing else, and relayed text (chat bridge, console,
 * reports) can ping nobody, even if it contains `@everyone` or `<@&id>`.
 */
import type { MentionPolicy } from "@mcbot/core/types/index.js";

export interface AllowedMentions {
  parse: [];
  roles?: string[];
}

export interface AlertMention {
  content?: string;
  allowedMentions: AllowedMentions;
}

/**
 * The allowedMentions block for a send. `none` blocks every ping; `role`
 * allows exactly the given role and nothing else.
 */
export function safeMentions(kind: "none"): AllowedMentions;
export function safeMentions(kind: "role", roleId: string): AllowedMentions;
export function safeMentions(kind: "none" | "role", roleId?: string): AllowedMentions {
  if (kind === "role" && roleId) return { parse: [], roles: [roleId] };
  return { parse: [] };
}

/** Message fields that ping the configured role, or a silent send when unset. */
export function roleMention(mentionRole: string | undefined): AlertMention {
  if (!mentionRole) return { allowedMentions: safeMentions("none") };
  return {
    content: `<@&${mentionRole}>`,
    allowedMentions: safeMentions("role", mentionRole),
  };
}

/** How bad an alert is. Ordered: a higher rank is worse. */
export type AlertLevel = "ok" | "warning" | "error" | "critical";

const LEVEL_RANK: Record<AlertLevel, number> = { ok: 0, warning: 1, error: 2, critical: 3 };

/**
 * Whether a change from `previous` to `next` deserves a ping under the
 * escalation policy: the first failure and every rise in severity do;
 * recoveries, repeats and improvements never do.
 */
export function shouldPing(previous: AlertLevel, next: AlertLevel): boolean {
  return LEVEL_RANK[next] > LEVEL_RANK[previous];
}

/**
 * The mention fields for one alert. `always` pings the role on every alert
 * (the default, as before); `escalation` pings only when `shouldPing` says so.
 */
export function alertMention(
  mentionRole: string | undefined,
  policy: MentionPolicy | undefined,
  previous: AlertLevel,
  next: AlertLevel,
): AlertMention {
  const ping = policy !== "escalation" || shouldPing(previous, next);
  return roleMention(ping ? mentionRole : undefined);
}
