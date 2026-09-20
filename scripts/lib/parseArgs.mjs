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
  if (!["bot", "web", "both"].includes(out.only)) {
    throw new Error(`--only must be "bot", "web", or "both" (got "${out.only}")`);
  }
  return out;
}
