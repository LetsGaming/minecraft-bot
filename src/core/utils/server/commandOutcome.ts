/**
 * Turning a CommandOutcome into an admin-facing verdict. Commands that record
 * state after a console change (bans, whitelist edits) call
 * requireAccepted() first, so an unreachable server aborts before anything is
 * written and the admin is told why.
 */
import { wasAccepted, type CommandOutcome } from "@mcbot/schema/commandOutcome.js";
import { t } from "../i18n.js";

/** Output the vanilla console gives for a command it did not run. */
const COMMAND_NOT_RUN = /^(Unknown or incomplete command|Incorrect argument)/i;

export interface AcceptOptions {
  /** Console replies, beyond the generic ones, that mean the change did not happen. */
  refusal?: RegExp;
}

/**
 * Throws a user-presentable error unless the command reached the server and
 * was not visibly refused. Returns whether the result is unverified, which is
 * the case when the server has no channel to answer on.
 */
export function requireAccepted(
  outcome: CommandOutcome,
  server: string,
  { refusal }: AcceptOptions = {},
): { unverified: boolean } {
  if (!wasAccepted(outcome)) {
    throw new Error(
      t("console.notDelivered", {
        server,
        reason: t(`console.reason.${outcome.reason}`),
      }),
    );
  }
  if (outcome.kind === "delivered") {
    const output = outcome.output.trim();
    if (COMMAND_NOT_RUN.test(output) || (refusal && refusal.test(output))) {
      throw new Error(t("console.refused", { server, output }));
    }
    return { unverified: false };
  }
  return { unverified: true };
}

/** The reply text with the "unverified" note appended when it applies. */
export function withUnverifiedNote(
  message: string,
  { unverified }: { unverified: boolean },
): string {
  return unverified ? `${message}\n${t("console.unverified")}` : message;
}
