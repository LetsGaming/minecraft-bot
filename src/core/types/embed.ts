// ── Embed utility types ───────────────────────────────────────────────────────

export interface EmbedOptions {
  title?: string;
  description?: string;
  color?: number;
  footer?: { text: string; iconURL?: string };
  timestamp?: Date | string | number | boolean;
  author?: { name: string; iconURL?: string };
}

export interface EmbedWithThumbnailOptions extends EmbedOptions {
  thumbnail?: string;
}

export interface EmbedStyleOptions {
  footer?: { text: string; iconURL?: string };
  timestamp?: Date | number | boolean;
}
