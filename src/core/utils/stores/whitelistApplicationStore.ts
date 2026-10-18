/**
 * Whitelist applications and the persistent "Apply" prompt per guild: single
 * owner of kv_store["whitelistApplications"].
 *
 * Every caller awaits Discord between deciding and writing, so changes go
 * through updateWhitelistApplications, which applies them to the stored
 * document inside one transaction. Saving a copy loaded before those awaits
 * would write it over applications submitted or decided in the meantime (an
 * approved one could go back to pending).
 */
import { documentStore } from "./versionedStore.js";

/**
 * Decided-application history kept per store. Pending applications are never
 * trimmed: they still need a working Approve/Deny button.
 */
export const MAX_DECIDED_APPLICATIONS = 200;

export type ApplicationStatus = "pending" | "approved" | "denied";

export interface WhitelistApplication {
  id: string;
  guildId: string;
  userId: string;
  userTag: string;
  mcName: string;
  note?: string;
  serverId: string;
  status: ApplicationStatus;
  createdAt: number;
  decidedBy?: string;
  decidedAt?: number;
}

export interface WhitelistApplicationStore {
  version: 1;
  /** guildId → the persistent Apply prompt message. */
  prompts: Record<string, { channelId: string; messageId: string }>;
  applications: WhitelistApplication[];
}

function normalize(raw: unknown): WhitelistApplicationStore {
  const doc = (typeof raw === "object" && raw !== null ? raw : {}) as Partial<WhitelistApplicationStore>;
  return {
    version: 1,
    prompts: doc.prompts ?? {},
    applications: doc.applications ?? [],
  };
}

/** Keep every pending application and the newest decided ones, oldest first. */
function trim(store: WhitelistApplicationStore): void {
  const pending = store.applications.filter((a) => a.status === "pending");
  const decided = store.applications
    .filter((a) => a.status !== "pending")
    .sort((a, b) => (a.decidedAt ?? 0) - (b.decidedAt ?? 0))
    .slice(-MAX_DECIDED_APPLICATIONS);
  store.applications = [...decided, ...pending].sort(
    (a, b) => a.createdAt - b.createdAt,
  );
}

const applicationDoc = documentStore<WhitelistApplicationStore>(
  "whitelistApplications",
  normalize,
);

export function loadWhitelistApplications(): WhitelistApplicationStore {
  return applicationDoc.load();
}

/** Change the store in one transaction, then trim the decided history. */
export function updateWhitelistApplications<T>(
  fn: (store: WhitelistApplicationStore) => T,
): T {
  return applicationDoc.update((store) => {
    const out = fn(store);
    trim(store);
    return out;
  });
}
