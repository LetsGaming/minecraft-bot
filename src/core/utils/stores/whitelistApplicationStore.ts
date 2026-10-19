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
import { MS } from "@mcbot/schema/time.js";
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
  /** Set while an admin is acting on a pending application. */
  claim?: { by: string; at: number };
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

/** How long a decision claim blocks other admins before it counts as abandoned (a crashed handler). */
export const CLAIM_TTL_MS = MS.minute * 2;

/** Pending applications from one user in one guild, claimed ones included. */
export function countPendingApplications(guildId: string, userId: string): number {
  return loadWhitelistApplications().applications.filter(
    (a) => a.status === "pending" && a.guildId === guildId && a.userId === userId,
  ).length;
}

/** Store a new pending application unless the user is already at `maxPending`. */
export function addPendingApplication(app: WhitelistApplication, maxPending: number): boolean {
  return updateWhitelistApplications((store) => {
    const pending = store.applications.filter(
      (a) => a.status === "pending" && a.guildId === app.guildId && a.userId === app.userId,
    ).length;
    if (pending >= maxPending) return false;
    store.applications.push(app);
    return true;
  });
}

export function removeWhitelistApplication(id: string): void {
  updateWhitelistApplications((store) => {
    store.applications = store.applications.filter((a) => a.id !== id);
  });
}

/**
 * Take the exclusive right to decide a pending application. Only the caller
 * that gets the application back may act on it; everyone else sees null. The
 * claim stays pending, so the one-per-user guard and the trim policy keep
 * covering it, and it lapses after CLAIM_TTL_MS.
 */
export function claimWhitelistApplication(
  id: string,
  guildId: string,
  by: string,
  now: number = Date.now(),
): WhitelistApplication | null {
  return updateWhitelistApplications((store) => {
    const app = store.applications.find((a) => a.id === id);
    if (!app || app.guildId !== guildId || app.status !== "pending") return null;
    if (app.claim && now - app.claim.at < CLAIM_TTL_MS) return null;
    app.claim = { by, at: now };
    return { ...app };
  });
}

/** Give a claimed application back after the action it was claimed for failed. */
export function releaseWhitelistApplication(id: string, by: string): void {
  updateWhitelistApplications((store) => {
    const app = store.applications.find((a) => a.id === id);
    if (app?.claim?.by === by) delete app.claim;
  });
}

/** Record the claim holder's decision. Null when the claim was lost in the meantime. */
export function settleWhitelistApplication(
  id: string,
  by: string,
  decision: { status: "approved" | "denied"; mcName: string; decidedBy: string; decidedAt: number },
): WhitelistApplication | null {
  return updateWhitelistApplications((store) => {
    const app = store.applications.find((a) => a.id === id);
    if (!app || app.status !== "pending" || app.claim?.by !== by) return null;
    delete app.claim;
    Object.assign(app, decision);
    return { ...app };
  });
}
