/**
 * The pinned "messages are forwarded" notice the bot keeps in each relayed
 * channel: single owner of kv_store["relayNotices"]. Holds ids and a content
 * key only, so the notice is edited when it changes and removed when the
 * channel stops relaying.
 */
import { documentStore } from "./versionedStore.js";

export interface RelayNoticeRecord {
  messageId: string;
  /** Fingerprint of what the notice says, to tell when it needs editing. */
  key: string;
}

interface RelayNotices {
  channels: Record<string, RelayNoticeRecord>;
}

const noticeDoc = documentStore<RelayNotices>("relayNotices", (raw) => {
  const doc = (typeof raw === "object" && raw !== null ? raw : {}) as Partial<RelayNotices>;
  return { channels: doc.channels && typeof doc.channels === "object" ? doc.channels : {} };
});

export function loadRelayNotices(): Record<string, RelayNoticeRecord> {
  return noticeDoc.load().channels;
}

export function setRelayNotice(channelId: string, record: RelayNoticeRecord | null): void {
  noticeDoc.update((store) => {
    if (record) store.channels[channelId] = record;
    else delete store.channels[channelId];
  });
}
