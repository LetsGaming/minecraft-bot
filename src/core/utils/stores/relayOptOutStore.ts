/**
 * Who opted out of being relayed to other Discord servers, per guild. Holds
 * only (guild id, Discord id) pairs in kv_store["relayOptOut"]: no names, no
 * messages, nothing about where the user spoke.
 */
import { documentStore } from "./versionedStore.js";

interface RelayOptOuts {
  /** guildId → Discord user id → true */
  guilds: Record<string, Record<string, true>>;
}

const optOutDoc = documentStore<RelayOptOuts>("relayOptOut", (raw) => {
  const doc = (typeof raw === "object" && raw !== null ? raw : {}) as Partial<RelayOptOuts>;
  return { guilds: doc.guilds && typeof doc.guilds === "object" ? doc.guilds : {} };
});

export function isRelayOptedOut(guildId: string, userId: string): boolean {
  return optOutDoc.load().guilds[guildId]?.[userId] === true;
}

/** Opt a user out of (or back into) relaying in one guild; false when nothing changed. */
export function setRelayOptOut(guildId: string, userId: string, optedOut: boolean): boolean {
  return optOutDoc.update((store) => {
    const guild = (store.guilds[guildId] ??= {});
    const was = guild[userId] === true;
    if (was === optedOut) {
      if (Object.keys(guild).length === 0) delete store.guilds[guildId];
      return false;
    }
    if (optedOut) guild[userId] = true;
    else delete guild[userId];
    if (Object.keys(guild).length === 0) delete store.guilds[guildId];
    return true;
  });
}
