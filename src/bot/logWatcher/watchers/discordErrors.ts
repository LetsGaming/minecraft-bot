/** Discord JSON error codes the watchers tell apart. */
const UNKNOWN_CHANNEL = 10003;
const UNKNOWN_MESSAGE = 10008;
const UNKNOWN_WEBHOOK = 10015;
const MISSING_ACCESS = 50001;

export function discordErrorCode(err: unknown): number | null {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === "number" ? code : null;
}

/** The channel was deleted or the bot lost access to it: cached references to it are stale. */
export function isChannelGone(err: unknown): boolean {
  const code = discordErrorCode(err);
  return code === UNKNOWN_CHANNEL || code === MISSING_ACCESS;
}

/** The message was deleted behind our back. */
export function isUnknownMessage(err: unknown): boolean {
  return discordErrorCode(err) === UNKNOWN_MESSAGE;
}

/** The webhook was deleted behind our back. */
export function isUnknownWebhook(err: unknown): boolean {
  const status = (err as { status?: unknown } | null)?.status;
  return discordErrorCode(err) === UNKNOWN_WEBHOOK || status === 404;
}
