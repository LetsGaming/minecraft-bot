import { ApiErrorCode } from "@mcbot/schema";
import { ApiError } from "../api";
import { t } from "../i18n";
import { errorMessage } from "./errorMessage";

export type DiscordFailureKind =
  | "token-missing"
  | "token-rejected"
  | "rate-limited"
  | "forbidden"
  | "unreachable"
  | "other";

/** Why a dashboard call that reads Discord failed, from the error code and status. */
export function discordFailureKind(err: unknown): DiscordFailureKind {
  if (!(err instanceof ApiError)) return "other";
  switch (err.code) {
    case ApiErrorCode.DiscordTokenMissing:
      return "token-missing";
    case ApiErrorCode.DiscordTokenRejected:
      return "token-rejected";
    case ApiErrorCode.RateLimited:
      return "rate-limited";
    case ApiErrorCode.Forbidden:
      return "forbidden";
    case ApiErrorCode.BadGateway:
      return "unreachable";
    default:
      return "other";
  }
}

export interface FailureCopy {
  title: string;
  recovery: string;
  /** The request's status and message, for whoever fixes it. */
  detail: string;
  /** The fix is a config change only a sysadmin can make. */
  fixInConfig: boolean;
}

/**
 * Problem and recovery for a failed Discord read. Token problems name the
 * setting to a sysadmin and tell anyone else whom to ask; `fallbackTitle`
 * covers failures that did not come from Discord at all.
 */
export function describeDiscordFailure(
  err: unknown,
  sysadmin: boolean,
  fallback: { title: string; recovery: string },
): FailureCopy {
  const detail = err instanceof ApiError ? `HTTP ${err.status}: ${err.message}` : errorMessage(err);
  const kind = discordFailureKind(err);
  if (kind === "token-missing" || kind === "token-rejected") {
    const missing = kind === "token-missing";
    return {
      title: t(missing ? "guilds.discord.tokenMissing" : "guilds.discord.tokenRejected"),
      recovery: sysadmin
        ? t(missing ? "guilds.discord.tokenMissingFix" : "guilds.discord.tokenRejectedFix")
        : t("guilds.discord.tokenAsk"),
      detail,
      fixInConfig: sysadmin,
    };
  }
  if (kind === "rate-limited") {
    return { title: t("guilds.discord.rateLimited"), recovery: t("guilds.discord.rateLimitedFix"), detail, fixInConfig: false };
  }
  if (kind === "forbidden") {
    return { title: t("guilds.discord.forbidden"), recovery: t("guilds.discord.forbiddenFix"), detail, fixInConfig: false };
  }
  if (kind === "unreachable") {
    return { title: t("guilds.discord.unreachable"), recovery: t("guilds.discord.unreachableFix"), detail, fixInConfig: false };
  }
  return { ...fallback, detail, fixInConfig: false };
}
