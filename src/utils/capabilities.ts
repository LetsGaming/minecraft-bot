/**
 * M-13 (stage 2): pure helpers around capability flags.
 *
 * Detection itself lives in serverAccess.ts (it's fs/API access and belongs
 * to the routing layer); this module only derives decisions from already
 * probed flags so the logic is trivially unit-testable.
 */
import type { ServerInstance } from "./server.js";
import type { ServerCapabilities } from "../types/index.js";

/** Pointer used in every capability-related message. */
export const CAPABILITY_DOCS_HINT =
  "See docs/admin/setup.md (feature matrix) for what works on a plain server.";

/**
 * Which capability-dependent slash commands should be skipped at
 * registration time. A command is only skipped when NO configured instance
 * provides the capability — in mixed setups (one suite server, one plain
 * server) it stays registered and the per-invocation gate produces a
 * friendly error for the plain instance.
 *
 * `/server` is intentionally NOT registration-gated: since H-05 it carries
 * the suite-independent `prune-stats` subcommand, so the command must exist
 * even when no instance has management scripts. Its script-based
 * subcommands are gated per invocation instead.
 */
export function capabilityCommandSkips(
  instances: ServerInstance[],
): Map<string, string> {
  const skips = new Map<string, string>();
  if (instances.length === 0) return skips; // nothing probed — don't gate

  const caps = instances.map((i) => i.capabilities);
  // Unprobed instances (null/undefined) count as capable — conservative.
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

/** One-line startup log summary, e.g. "scripts: start,stop — backups: no". */
export function capabilitySummary(cap: ServerCapabilities): string {
  const scripts = Object.entries(cap.scripts)
    .filter(([, ok]) => ok)
    .map(([name]) => name);
  const scriptPart = scripts.length > 0 ? scripts.join(",") : "none";
  return (
    `scripts: ${scriptPart} — backups: ${cap.backups ? "yes" : "no"}, ` +
    `mods: ${cap.modManifest ? "yes" : "no"}, ` +
    `variables.txt: ${cap.variablesFile ? "yes" : "no"}`
  );
}

/**
 * Per-invocation gate: throw a friendly, documented error when a probed
 * instance lacks the capability. Unprobed instances pass — the underlying
 * call will then fail exactly as it did before M-13.
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
    `**${server.id}** doesn't provide ${featureDescription} — this feature needs the setup-suite layout. ${CAPABILITY_DOCS_HINT}`,
  );
}
