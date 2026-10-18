/**
 * The release the update notifier last pinged admins about: single owner of
 * kv_store["updateNotifier"], so each new release is announced once.
 */
import { documentStore } from "./versionedStore.js";

interface NotifierState {
  lastNotifiedVersion?: string;
}

const notifierDoc = documentStore<NotifierState>("updateNotifier", (raw) =>
  typeof raw === "object" && raw !== null && !Array.isArray(raw)
    ? (raw as NotifierState)
    : {},
);

export function lastNotifiedVersion(): string | null {
  return notifierDoc.load().lastNotifiedVersion ?? null;
}

export function recordNotifiedVersion(version: string): void {
  notifierDoc.save({ lastNotifiedVersion: version });
}
