import { STATUS_ROLES, STATUS_TABLE } from "@mcbot/schema";

/** `--st-<role>` is the foreground, `--st-<role>-bg` the chip tint. */
export function statusTokens(): Record<string, string> {
  const tokens: Record<string, string> = {};
  for (const role of STATUS_ROLES) {
    const def = STATUS_TABLE[role];
    tokens[`--st-${role}`] = def.colour;
    tokens[`--st-${role}-bg`] = def.tint;
  }
  return tokens;
}

/** Set through the style object, which a strict style-src policy does not block. */
export function installStatusTokens(root: HTMLElement = document.documentElement): void {
  for (const [name, value] of Object.entries(statusTokens())) {
    root.style.setProperty(name, value);
  }
}
