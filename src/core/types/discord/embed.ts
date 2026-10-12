// ── Embed utility types ───────────────────────────────────────────────────────

import type { ServerState } from "@mcbot/schema/serverState.js";

export interface EmbedOptions {
  title?: string;
  description?: string;
  /** Defaults to the state's colour when `state` is set, else Info. */
  color?: number;
  footer?: { text: string; iconURL?: string };
  /** Off by default; only live data (status, alerts) carries one. */
  timestamp?: Date | string | number | boolean;
  author?: { name: string; iconURL?: string };
  /** Server state: prefixes the title with its circle and sets the colour. */
  state?: ServerState;
}

export interface EmbedWithThumbnailOptions extends EmbedOptions {
  thumbnail?: string;
}

export interface EmbedStyleOptions {
  /** Names the object or action. Without it the embed has no title. */
  title?: string;
  footer?: { text: string; iconURL?: string };
  timestamp?: Date | number | boolean;
}

/** An error as the user reads it: what failed, then what to do. */
export interface ErrorContent {
  /** Names the failed action ("Could not reach smp"); a generic fallback otherwise. */
  title?: string;
  problem: string;
  recovery?: string;
}
