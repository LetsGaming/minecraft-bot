/** Minimal flag parser shared by scripts/dev-up.mjs and scripts/dev-down.mjs. */
export function parseArgs(argv) {
  const out = {
    id: "default",
    only: "both", // "bot" | "web" | "both"
    verbose: false,
    realDiscord: false,
    realAuth: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--id":
        out.id = argv[++i] ?? out.id;
        break;
      case "--only":
        out.only = argv[++i] ?? out.only;
        break;
      case "--verbose":
        out.verbose = true;
        break;
      case "--real-discord":
        out.realDiscord = true;
        break;
      case "--real-auth":
        out.realAuth = true;
        break;
      default:
        // Unknown flags are ignored rather than rejected — keeps this parser
        // tiny and lets callers add their own ad-hoc flags without touching it.
        break;
    }
  }
  // The id becomes a directory name that dev-up and dev-down delete
  // recursively (data/agent-<id>/, logs/agent-<id>/). `x/../../..` would
  // point that delete outside data/ (AUD-031), so only plain names pass.
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(out.id)) {
    throw new Error(
      `--id must be letters, digits, "-" or "_" (at most 64, starting with a letter or digit); got "${out.id}"`,
    );
  }
  if (!["bot", "web", "both"].includes(out.only)) {
    throw new Error(`--only must be "bot", "web", or "both" (got "${out.only}")`);
  }
  return out;
}
