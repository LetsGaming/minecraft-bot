/**
 * Why a wrapper config call failed, as something a route can show to a person.
 *
 * Kept apart from serverAccess so route code can test `instanceof` without
 * importing the whole wrapper client.
 */
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
    case 404:
      return new ConfigAccessError("not-found", "That config file no longer exists on the server.", status);
    case 412:
      return new ConfigAccessError(
        "stale",
        "This file changed since you opened it. Reload and re-apply your changes.",
        status,
      );
    case 413:
      return new ConfigAccessError(
        "too-large",
        action === "read"
          ? "This file is larger than the 1 MB limit for the config editor."
          : "The saved file would be larger than the 1 MB limit for the config editor.",
        status,
      );
    case 428:
      return new ConfigAccessError(
        "precondition-required",
        "The save did not say which version it replaces. Reload and try again.",
        status,
      );
    case 400:
      return new ConfigAccessError("rejected", `The wrapper rejected the request: ${wrapperMessage}`, status);
    case 403:
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
