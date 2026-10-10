/**
 * Whether the running bot has picked up the config.json on disk, as the
 * dashboard reports it next to every config editor.
 */
export const ConfigApplyState = {
  /** The bot reported applying exactly the file that is on disk. */
  Applied: "applied",
  /** The file changed and the bot has not reported applying it yet. */
  Pending: "pending",
  /** No fresh heartbeat; the change applies when the bot starts. */
  BotDown: "bot-down",
  /** Applied, but some server-connection settings only take effect after a restart. */
  RestartRequired: "restart-required",
  /** The bot is alive but predates the applied-revision report. */
  Unknown: "unknown",
} as const;
export type ConfigApplyState = (typeof ConfigApplyState)[keyof typeof ConfigApplyState];

export interface ConfigStatusResponse {
  state: ConfigApplyState;
  /** The file on disk: sha256 of its bytes and its modification time (epoch ms). */
  revision: { hash: string; at: number };
  /** What the bot last reported applying, or null when it never reported. */
  applied: { hash: string; at: number } | null;
  /** Server ids whose connection settings changed and need a bot restart. */
  restartRequired: string[];
  botAlive: boolean;
}
