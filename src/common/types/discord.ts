// ── Discord channel management types ─────────────────────────────────────────

import type {
  CategoryChannel,
  Guild,
  TextChannel,
  VoiceChannel,
} from "discord.js";

export interface ManagedCategory {
  category: CategoryChannel;
  guild: Guild;
}

export interface EnsuredTextChannel {
  channel: TextChannel;
  categoryId: string;
}

export interface EnsuredVoiceChannel {
  channel: VoiceChannel;
  categoryId: string;
}
