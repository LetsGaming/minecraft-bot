/**
 * Colon-separated `key:value` text settings, as written by Xaero's Minimap,
 * World Map and Lib (`xaerominimap.txt`, `xaeroworldmap.txt`, the files under
 * `config/xaero/`).
 *
 * The layout, checked against real files (for example the AllTheMods
 * `xaerominimap.txt` and `xaeroworldmap.txt`): one `key:value` per line, `#`
 * lines are comments, the key is letters, digits and underscores, and the value
 * is everything after the FIRST colon (`minimapItemId:minecraft:compass` has the
 * value `minecraft:compass`). Some keys repeat (`interface:...` once per HUD
 * element), and waypoint files use the same shape for rows that are data, not
 * settings.
 *
 * Because `.txt` is shared by countless unrelated files, this adapter only
 * claims a file when every non-empty line is a comment or a `key:value` line.
 * Waypoint files and anything else stay plain read-only text. Repeated keys are
 * listed read-only.
 */
import type { ConfigFormat, ConfigNode, ConfigValueKind, ParsedConfig } from "./types.js";
import { ConfigEditError } from "./types.js";
import { inferScalar, markDuplicates, numberLiteral, scanLines } from "./lines.js";

const KEY_LINE = /^([A-Za-z][A-Za-z0-9_]*):(.*)$/;

/** Keys that mark a file as data rows rather than settings. */
const DATA_KEYS = new Set(["waypoint", "sets", "seed", "mappoint"]);

function detect(sample: string, fileName: string): boolean {
  if (/waypoint/i.test(fileName)) return false;
  let keys = 0;
  for (const { line } of scanLines(sample)) {
    const t = line.trim();
    if (t === "" || t.startsWith("#")) continue;
    const m = KEY_LINE.exec(line);
    if (!m) return false;
    if (DATA_KEYS.has(m[1]!.toLowerCase())) return false;
    keys++;
  }
  return keys > 0;
}

export const colonTextFormat: ConfigFormat = {
  id: "colon-text",
  extensions: [],
  detectExtensions: [".txt"],
  detect,

  parse(text: string): ParsedConfig {
    const nodes: ConfigNode[] = [];
    for (const { line, start } of scanLines(text)) {
      const m = KEY_LINE.exec(line);
      if (!m) continue;
      const key = m[1]!;
      const raw = m[2]!;
      const valueStart = start + key.length + 1;
      const scalar = inferScalar(raw);
      nodes.push({
        path: [key],
        key,
        kind: scalar.kind,
        value: scalar.value,
        comments: [],
        valueSpan: [valueStart, valueStart + raw.length],
        ...(scalar.float ? { hint: "float" } : {}),
      });
    }
    return { nodes: markDuplicates(nodes) };
  },

  literal(value: unknown, kind: ConfigValueKind, node?: ConfigNode): string {
    if (kind === "boolean") return value ? "true" : "false";
    if (kind === "number") return numberLiteral(value, node?.hint === "float");
    const text = String(value ?? "");
    if (/[\r\n]/.test(text)) throw new ConfigEditError("A value cannot contain a line break.");
    return text;
  },
};
