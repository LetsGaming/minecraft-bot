/**
 * The backend reports validation problems as lines like
 * `  - guilds.123.chatBridge: message`. Lines that start with a config path are
 * attached to the editor section that owns that path; the rest stay general.
 */
export interface FieldError {
  path: string[];
  message: string;
}

const LINE = /^\s*-?\s*([A-Za-z_][\w\-.[\]]*)(?:\s*\([^)]*\))?:\s*(.*)$/;

export function parseFieldError(line: string): FieldError | null {
  const match = LINE.exec(line);
  if (!match) return null;
  const path = match[1]!
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .filter((p) => p.length > 0);
  return path.length > 0 ? { path, message: match[2]! } : null;
}

export interface GroupedErrors {
  /** Section key to the messages that belong to it. */
  bySection: Record<string, string[]>;
  /** Everything that did not map to a section. */
  general: string[];
}

/**
 * @param sectionOf Maps a parsed path to the section key it belongs to, or
 *                  null when the path is outside every section.
 */
export function groupErrors(
  lines: readonly string[],
  sectionOf: (path: string[]) => string | null,
): GroupedErrors {
  const out: GroupedErrors = { bySection: {}, general: [] };
  for (const line of lines) {
    const parsed = parseFieldError(line);
    const section = parsed ? sectionOf(parsed.path) : null;
    if (parsed && section) {
      (out.bySection[section] ??= []).push(`${parsed.path.join(".")}: ${parsed.message}`);
    } else {
      out.general.push(line.replace(/^\s*-\s*/, ""));
    }
  }
  return out;
}
