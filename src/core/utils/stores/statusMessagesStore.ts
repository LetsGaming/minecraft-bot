/**
 * The status-embed channels and message the bot manages per guild: single
 * owner of kv_store["statusMessages"]. Written by the status embed scheduler,
 * read by the channel purge to protect the embed message.
 *
 * Shape: { "<guildId>": { categoryId, textChannelId, messageId, voiceChannelId } }
 */
import type { StatusChannelState, StatusMessageState } from "../../types/index.js";
import { documentStore } from "./versionedStore.js";

const statusDoc = documentStore<StatusMessageState>("statusMessages", (raw) =>
  typeof raw === "object" && raw !== null && !Array.isArray(raw)
    ? (raw as StatusMessageState)
    : {},
);

export function loadStatusMessages(): StatusMessageState {
  return statusDoc.load();
}

/** Change the state in one transaction; see versionedStore. */
export function updateStatusMessages<T>(
  fn: (state: StatusMessageState) => T,
): T {
  return statusDoc.update(fn);
}

/** The managed channels of one guild, or null before provisioning. */
export function statusChannelsFor(guildId: string): StatusChannelState | null {
  const state = statusDoc.load();
  return Object.hasOwn(state, guildId) ? (state[guildId] ?? null) : null;
}
