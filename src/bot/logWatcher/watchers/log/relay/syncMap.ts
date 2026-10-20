/** Where one relayed copy of a message was posted. */
export interface RelayedCopy {
  channelId: string;
  messageId: string;
  /** Sent by the channel's bridge webhook (edited through it) rather than by the bot. */
  viaWebhook: boolean;
}

interface Entry {
  copies: RelayedCopy[];
  expiresAt: number;
}

const MAX_ENTRIES = 5000;

/**
 * Source message id to the copies posted in other servers, for edit and
 * delete sync. Ids only, in memory only: a restart ends the window, nothing
 * about the message or its author is kept, and entries expire on their own.
 */
export class RelaySyncMap {
  private readonly entries = new Map<string, Entry>();

  remember(sourceId: string, copies: RelayedCopy[], windowMs: number, now = Date.now()): void {
    if (copies.length === 0) return;
    this.entries.delete(sourceId);
    this.entries.set(sourceId, { copies, expiresAt: now + windowMs });
    this.prune(now);
  }

  /** The live copies of a source message, or null once the window has closed. */
  copiesOf(sourceId: string, now = Date.now()): RelayedCopy[] | null {
    const entry = this.entries.get(sourceId);
    if (!entry) return null;
    if (entry.expiresAt <= now) {
      this.entries.delete(sourceId);
      return null;
    }
    return entry.copies;
  }

  forget(sourceId: string): void {
    this.entries.delete(sourceId);
  }

  get size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }

  private prune(now: number): void {
    for (const [id, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(id);
      else break; // insertion order is expiry order while the window is constant
    }
    while (this.entries.size > MAX_ENTRIES) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }
}
