import { ApiError, UnauthorizedError } from "../api";
import { t } from "../i18n";

/**
 * Why a read failed, sorted by what the reader can do about it:
 * sign in again, ask for access, wait for something upstream, or retry.
 * "Nothing there" is never one of these: an empty answer is a success.
 */
export type LoadFailure = "signedOut" | "forbidden" | "unreachable" | "failed";

const UPSTREAM_STATUSES = new Set([502, 503, 504]);

export function loadFailure(err: unknown): LoadFailure {
  if (err instanceof UnauthorizedError) return "signedOut";
  if (err instanceof ApiError) {
    if (err.status === 401) return "signedOut";
    if (err.status === 403) return "forbidden";
    if (UPSTREAM_STATUSES.has(err.status)) return "unreachable";
  }
  return "failed";
}

/** What an InlineError shows for one failed read. */
export interface FailureCopy {
  title: string;
  recovery: string;
  detail: string;
  retryable: boolean;
  retryLabel: string;
}

export interface FailureSubject {
  /** "The server status did not load". */
  failedTitle: string;
  /** What to try when the dashboard or something behind it did not answer. */
  failedText: string;
  /** "You cannot see the audit log". */
  forbiddenTitle: string;
  /** The capability that grants the read, named in the recovery. */
  capability: string;
  /** Replaces the capability sentence when access is not a plain grant. */
  forbiddenText?: string;
  /** The request and the error message, for whoever fixes it. */
  request: string;
  error: string;
}

/**
 * The copy for a failed read. A signed-out reader gets a way back in instead
 * of a retry that fails the same way; a reader without the grant gets told
 * whom to ask instead of a retry at all.
 */
export function failureCopy(kind: LoadFailure, subject: FailureSubject): FailureCopy {
  if (kind === "signedOut") {
    return {
      title: t("monitor.signedOutTitle"),
      recovery: t("monitor.signedOutText"),
      detail: "",
      retryable: true,
      retryLabel: t("monitor.signIn"),
    };
  }
  if (kind === "forbidden") {
    return {
      title: subject.forbiddenTitle,
      recovery: subject.forbiddenText || t("monitor.forbiddenText", { capability: subject.capability }),
      detail: "",
      retryable: false,
      retryLabel: "",
    };
  }
  return {
    title: subject.failedTitle,
    recovery: subject.failedText,
    detail: subject.error ? t("monitor.requestDetail", { request: subject.request, error: subject.error }) : "",
    retryable: true,
    retryLabel: "",
  };
}

/** Where Retry on a signed-out error goes. */
export function signIn(): void {
  window.location.href = "/auth/login";
}
