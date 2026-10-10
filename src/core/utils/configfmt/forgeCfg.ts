/**
 * Legacy Forge `.cfg` files (1.12 and older mods).
 *
 *     general {
 *         # Comment lines start with a hash.
 *         B:enableThing=true
 *         I:count=5
 *         D:ratio=0.5
 *         S:name=value
 *         S:list <
 *             a
 *             b
 *          >
 *     }
 *
 * Blocks nest and become path segments. Entries are `<type>:<name>=<value>` with
 * type B (boolean), I (integer), D (double) or S (string); a name containing
 * spaces is double-quoted. Lists (`<` ... `>`) are listed read-only. A file is
 * claimed only when every non-empty line is one of these shapes, so a `.cfg`
 * in some other layout falls through to the INI adapter or stays plain text.
 */
import type { ConfigFormat, ConfigNode, ConfigValueKind, ParsedConfig } from "./types.js";
import { ConfigEditError } from "./types.js";
import { CommentBlock, markDuplicates, numberLiteral, scanLines } from "./lines.js";

const BLOCK_OPEN = /^("[^"]*"|[^\s{}=<>#:]+)\s*\{$/;
const ENTRY = /^([BIDS]):("[^"]*"|[^\s=<>"]+)=(.*)$/;
const LIST_OPEN = /^([BIDS]):("[^"]*"|[^\s=<>"]+)\s*<$/;

const unquote = (s: string): string =>
  s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s;

interface Scan {
  nodes: ConfigNode[];
  foreign: number;
}

function scan(text: string): Scan {
  const nodes: ConfigNode[] = [];
  const stack: string[] = [];
  const comments = new CommentBlock();
  let foreign = 0;
  let list: { key: string; items: string[]; start: number } | null = null;

  for (const { line, start } of scanLines(text)) {
    const t = line.trim();
    if (list) {
      if (t === ">") {
        nodes.push({
          path: [...stack, list.key],
          key: list.key,
          kind: "unknown",
          value: list.items,
          comments: comments.take(),
          valueSpan: [list.start, list.start],
          readOnly: true,
        });
        list = null;
      } else if (t !== "") list.items.push(t);
      continue;
    }
    if (t === "") {
      comments.reset();
      continue;
    }
    if (t.startsWith("#")) {
      comments.add(t.replace(/^#+\s?/, ""));
      continue;
    }
    const open = BLOCK_OPEN.exec(t);
    if (open) {
      stack.push(unquote(open[1]!));
      comments.reset();
      continue;
    }
    if (t === "}") {
      if (stack.length === 0) foreign++;
      stack.pop();
      comments.reset();
      continue;
    }
    const listOpen = LIST_OPEN.exec(t);
    if (listOpen) {
      list = { key: unquote(listOpen[2]!), items: [], start };
      continue;
    }
    const entry = ENTRY.exec(t);
    if (!entry) {
      foreign++;
      comments.reset();
      continue;
    }
    const type = entry[1]!;
    const key = unquote(entry[2]!);
    const raw = entry[3]!;
    const lead = line.length - line.trimStart().length;
    const valueStart = start + lead + type.length + 1 + entry[2]!.length + 1;

    let kind: ConfigValueKind = "string";
    let value: unknown = raw;
    let readOnly = false;
    if (type === "B") {
      kind = "boolean";
      value = raw.trim() === "true";
      if (raw.trim() !== "true" && raw.trim() !== "false") readOnly = true;
    } else if (type === "I" || type === "D") {
      kind = "number";
      const n = Number(raw.trim());
      value = n;
      if (raw.trim() === "" || !Number.isFinite(n)) readOnly = true;
    }

    nodes.push({
      path: [...stack, key],
      key,
      kind,
      value,
      comments: comments.take(),
      valueSpan: [valueStart, valueStart + raw.length],
      hint: type,
      ...(readOnly ? { readOnly: true } : {}),
    });
  }
  if (list || stack.length > 0) foreign++;
  return { nodes, foreign };
}

export const forgeCfgFormat: ConfigFormat = {
  id: "forge-cfg",
  extensions: [],
  detectExtensions: [".cfg"],
  detect(sample) {
    const { nodes, foreign } = scan(sample);
    return nodes.length > 0 && foreign === 0;
  },

  parse(text: string): ParsedConfig {
    return { nodes: markDuplicates(scan(text).nodes) };
  },

  literal(value: unknown, kind: ConfigValueKind, node?: ConfigNode): string {
    if (kind === "boolean") return value ? "true" : "false";
    if (kind === "number") {
      if (node?.hint === "I") {
        const n = Number(value);
        if (!Number.isInteger(n)) throw new ConfigEditError("This setting needs a whole number.");
        return String(n);
      }
      return numberLiteral(value, true);
    }
    const text = String(value ?? "");
    if (/[\r\n]/.test(text)) throw new ConfigEditError("A value cannot contain a line break.");
    return text;
  },
};
