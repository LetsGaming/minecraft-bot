import type { GuildFeatureKey } from "@mcbot/schema";
import { t } from "../i18n";

/** The icon each guild feature carries on the Guilds page and in the setup wizard. */
export const FEATURE_ICON: Record<GuildFeatureKey, string> = {
  notifications: "pi pi-bell",
  chatBridge: "pi pi-comments",
  leaderboard: "pi pi-chart-bar",
  statusEmbed: "pi pi-desktop",
  downtimeAlerts: "pi pi-exclamation-triangle",
  tpsAlerts: "pi pi-gauge",
  channelPurge: "pi pi-trash",
  reports: "pi pi-flag",
  console: "pi pi-code",
  whitelistApplications: "pi pi-user-plus",
  linkedRole: "pi pi-id-card",
};

export function featureLabel(key: GuildFeatureKey): string {
  return t(`guilds.feature.${key}`);
}

export function featureHint(key: GuildFeatureKey): string {
  return t(`guilds.featureHint.${key}`);
}
