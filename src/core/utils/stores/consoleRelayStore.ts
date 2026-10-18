/**
 * Which guild/server pairs relay the live server console into a channel:
 * single owner of kv_store["consoleRelay"].
 */
import { documentStore } from "./versionedStore.js";

export interface ConsoleRelayState {
  /** guildId → serverId → enabled */
  guilds: Record<string, Record<string, boolean>>;
}

const relayDoc = documentStore<ConsoleRelayState>("consoleRelay", (raw) => {
  const doc = (typeof raw === "object" && raw !== null ? raw : {}) as Partial<ConsoleRelayState>;
  return { guilds: doc.guilds ?? {} };
});

export function loadConsoleRelayState(): ConsoleRelayState {
  return relayDoc.load();
}

/** Change the state in one transaction; see versionedStore. */
export function updateConsoleRelayState<T>(
  fn: (state: ConsoleRelayState) => T,
): T {
  return relayDoc.update(fn);
}

/** Turn the relay on or off for one guild and server. */
export function setConsoleRelayEnabled(
  guildId: string,
  serverId: string,
  enabled: boolean,
): void {
  relayDoc.update((state) => {
    const guild = (state.guilds[guildId] ??= {});
    if (enabled) guild[serverId] = true;
    else delete guild[serverId];
  });
}
