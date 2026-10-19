/**
 * Why a wrapper config call failed, as something a route can show to a person.
 *
 * Kept apart from serverAccess so route code can test `instanceof` without
 * importing the whole wrapper client.
 */

/** The wrapper's size limit for a config file, in the words the editor shows. */
const CONFIG_SIZE_LIMIT_LABEL = "1 MB";

/** The statuses the wrapper uses to explain a config call, by what each means. */
const STATUS = {
  notFound: 404,
  stale: 412,
  tooLarge: 413,
  preconditionRequired: 428,
  rejected: 400,
  protected: 403,
} as const;

export type ConfigAccessErrorKind =
  | "too-large"
  | "not-found"
  | "stale"
  | "precondition-required"
  | "rate-limited"
  | "rejected"
  | "protected";

export class ConfigAccessError extends Error {
  constructor(
    readonly kind: ConfigAccessErrorKind,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ConfigAccessError";
  }
}

/** Map a non-OK wrapper status to a typed error, or null for statuses that mean "wrapper unavailable". */
export function configAccessErrorFor(
  status: number,
  action: string,
  wrapperMessage: string,
): ConfigAccessError | null {
  switch (status) {
    case STATUS.notFound:
      return new ConfigAccessError("not-found", "That config file no longer exists on the server.", status);
    case STATUS.stale:
      return new ConfigAccessError(
        "stale",
        "This file changed since you opened it. Reload and re-apply your changes.",
        status,
      );
    case STATUS.tooLarge:
      return new ConfigAccessError(
        "too-large",
        action === "read"
          ? `This file is larger than the ${CONFIG_SIZE_LIMIT_LABEL} limit for the config editor.`
          : `The saved file would be larger than the ${CONFIG_SIZE_LIMIT_LABEL} limit for the config editor.`,
        status,
      );
    case STATUS.preconditionRequired:
      return new ConfigAccessError(
        "precondition-required",
        "The save did not say which version it replaces. Reload and try again.",
        status,
      );
    case STATUS.rejected:
      return new ConfigAccessError("rejected", `The wrapper rejected the request: ${wrapperMessage}`, status);
    case STATUS.protected:
      // Wrapper mod-configs v2: a server.properties key that decides who may
      // join or command the server changed without allowProtected.
      return new ConfigAccessError(
        "protected",
        `Only a bot administrator can change this setting: ${wrapperMessage}`,
        status,
      );
    default:
      return null;
  }
}
