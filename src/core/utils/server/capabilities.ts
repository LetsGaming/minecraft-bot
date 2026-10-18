/**
 * Pure helpers around capability flags.
 *
 * Detection itself is an API call (access/capabilityProbe.ts); this module
 * only derives decisions from already probed flags so the logic is trivially
 * unit-testable.
 */
import type { ServerInstance } from "./server.js";
import type { ServerCapabilities } from "../../types/index.js";
import { t } from "../i18n.js";

/** Pointer used in every capability-related message. */
export const CAPABILITY_DOCS_HINT =
  "See docs/admin/setup.md (feature matrix) for what works on a plain server.";

/**
 * Which capability-dependent slash commands should be skipped at
 * registration time. A command is only skipped when NO configured instance
 * provides the capability; in mixed setups (one suite server, one plain
 * server) it stays registered and the per-invocation gate produces a
 * friendly error for the plain instance.
 *
 * `/server` is intentionally NOT registration-gated: it also carries
 * the suite-independent `prune-stats` subcommand, so the command must exist
 * even when no instance has management scripts. Its script-based
 * subcommands are gated per invocation instead.
 */
export function capabilityCommandSkips(
  instances: ServerInstance[],
): Map<string, string> {
  const skips = new Map<string, string>();
  if (instances.length === 0) return skips; // nothing probed; don't gate

  const caps = instances.map((i) => i.capabilities);
  // Unprobed instances (null/undefined) count as capable; conservative.
  const any = (pick: (c: ServerCapabilities) => boolean): boolean =>
    caps.some((c) => c == null || pick(c));

  if (!any((c) => c.backups)) {
    skips.set(
      "backup",
      "no configured server has the suite backup directory layout",
    );
  }
  if (!any((c) => c.modManifest)) {
    skips.set(
      "mods",
      "no configured server has common/downloaded_versions.json",
    );
  }
  return skips;
}

/** How each non-script flag reads in the startup summary. Exhaustive over the flags, so a new one must be named here. */
const FLAG_LABELS: Record<Exclude<keyof ServerCapabilities, "scripts">, string> = {
  backups: "backups",
  restore: "restore",
  modManifest: "mods",
  variablesFile: "variables.txt",
  upgrade: "upgrade",
  prune: "prune",
};

/** One-line startup log summary, e.g. "scripts: start,stop; backups: no, restore: yes, ...". */
export function capabilitySummary(cap: ServerCapabilities): string {
  const scripts = Object.entries(cap.scripts)
    .filter(([, ok]) => ok)
    .map(([name]) => name);
  const flags = (Object.keys(FLAG_LABELS) as Array<keyof typeof FLAG_LABELS>).map((key) => {
    const value = cap[key];
    return `${FLAG_LABELS[key]}: ${value === undefined ? "unknown" : value ? "yes" : "no"}`;
  });
  return `scripts: ${scripts.length > 0 ? scripts.join(",") : "none"}; ${flags.join(", ")}`;
}

/**
 * Per-invocation gate: throw a friendly, documented error when a probed
 * instance lacks the capability. Unprobed instances pass; the underlying
 * call will then fail with the usual script-not-found error.
 */
export function requireCapability(
  server: ServerInstance,
  check: (c: ServerCapabilities) => boolean,
  featureDescription: string,
): void {
  const cap = server.capabilities;
  // == null also covers `undefined` from partially-shaped test doubles.
  if (cap == null) return;
  if (check(cap)) return;
  throw new Error(
    t("capability.missing", {
      server: server.id,
      feature: featureDescription,
      hint: CAPABILITY_DOCS_HINT,
    }),
  );
}
