/**
 * Adapters for `.properties` and JSON.
 *
 * `.properties` — vanilla `server.properties` and a handful of older mods.
 * Line based and trivially position-preserving.
 *
 * `.json` / `.json5` — Fabric. Backed by `jsonc-parser`, the scanner behind
 * VS Code's JSON support, because it reports offsets, tolerates comments and
 * trailing commas, and does not mind the JSON5 that Fabric mods emit.
 */
import {
  parseTree,
  type Node as JsonNode,
  type ParseError,
} from "jsonc-parser";
import { CommentBlock, markDuplicates, scanLines } from "./lines.js";
import type {
  ConfigFormat,
  ConfigNode,
  ConfigValueKind,
  ParsedConfig,
} from "./types.js";

// ── .properties ──────────────────────────────────────────────────────────────

/**
 * `key=value` or `key: value`, capturing where the value starts. The key may
 * contain escaped characters (`a\:b`).
 *
 * Note there is no trailing-comment handling: in a properties file a `#` is
 * only a comment at the start of a line, so `motd=Welcome # home` has a `#`
 * in the motd and stripping it would silently change the server's greeting.
 */
const PROP_ENTRY_RE = /^([^#!=:\s](?:\\.|[^=:\\])*?)(\s*[=:]\s*)(.*)$/;

/** True when the line ends in an odd number of backslashes (it continues). */
function continues(line: string): boolean {
  const m = /\\+$/.exec(line);
  return m !== null && m[0].length % 2 === 1;
}

const PROP_ESCAPES: Record<string, string> = { n: "\n", t: "\t", r: "\r", f: "\f" };

/** Decode a properties value: `\:` is `:`, `\uXXXX` is a code unit, `\n` a newline. */
function unescapeProperty(raw: string): string {
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]!;
    if (ch !== "\\") {
      out += ch;
      continue;
    }
    const next = raw[++i];
    if (next === undefined) break;
    if (next === "u" && /^[0-9a-fA-F]{4}$/.test(raw.slice(i + 1, i + 5))) {
      out += String.fromCharCode(parseInt(raw.slice(i + 1, i + 5), 16));
      i += 4;
    } else {
      out += PROP_ESCAPES[next] ?? next;
    }
  }
  return out;
}

function escapeProperty(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")
    .replace(/^ /, "\\ ");
}

function inferPropertyKind(raw: string): ConfigValueKind {
  const t = raw.trim();
  if (t === "true" || t === "false") return "boolean";
  if (t !== "" && /^-?\d+(\.\d+)?$/.test(t)) return "number";
  return "string";
}

export const propertiesFormat: ConfigFormat = {
  id: "properties",
  extensions: [".properties"],

  parse(text: string): ParsedConfig {
    const nodes: ConfigNode[] = [];
    const comments = new CommentBlock();
    const lines = scanLines(text);

    for (let i = 0; i < lines.length; i++) {
      const { line, start: lineStart } = lines[i]!;
      const trimmed = line.trim();

      if (trimmed === "") {
        comments.reset();
        continue;
      }
      if (trimmed.startsWith("#") || trimmed.startsWith("!")) {
        comments.add(trimmed.replace(/^[#!]+\s?/, ""));
        continue;
      }

      const entry = PROP_ENTRY_RE.exec(line);
      if (!entry) {
        comments.reset();
        continue;
      }
      const [, key = "", separator = "", value = ""] = entry;

      // A value continued onto the next lines is shown but never rewritten,
      // and the continuation lines are not keys.
      let joined = false;
      let continued = value;
      if (continues(line)) {
        joined = true;
        continued = value.slice(0, -1);
        while (i + 1 < lines.length) {
          const next = lines[++i]!.line;
          const body = next.replace(/^\s+/, "");
          if (continues(next)) continued += body.slice(0, -1);
          else {
            continued += body;
            break;
          }
        }
      }

      const valueStart = lineStart + key.length + separator.length;
      const kind = joined ? "string" : inferPropertyKind(value);
      const cleanKey = unescapeProperty(key.trim());

      nodes.push({
        path: [cleanKey],
        key: cleanKey,
        kind,
        value:
          kind === "boolean"
            ? value.trim() === "true"
            : kind === "number"
              ? Number(value.trim())
              : unescapeProperty(continued),
        comments: comments.take(),
        valueSpan: [valueStart, valueStart + value.length],
        ...(joined ? { readOnly: true } : {}),
      });
    }

    return { nodes: markDuplicates(nodes) };
  },

  /**
   * Values are written without quotes. A properties value runs to end of line,
   * so quoting it would put literal quote characters into the file: a `motd`
   * of `"Hello"` instead of `Hello`. Backslashes and line breaks are escaped
   * so a value can never turn into a second line.
   */
  literal(value: unknown, kind: ConfigValueKind): string {
    if (kind === "boolean") return value ? "true" : "false";
    if (Array.isArray(value)) return value.map((v) => escapeProperty(String(v))).join(",");
    return escapeProperty(String(value ?? ""));
  },
};

// ── .json / .json5 ───────────────────────────────────────────────────────────

function jsonKind(node: JsonNode): ConfigValueKind {
  switch (node.type) {
    case "boolean":
      return "boolean";
    case "number":
      return "number";
    case "string":
      return "string";
    case "array": {
      const items = node.children ?? [];
      if (items.length === 0) return "stringList";
      if (items.every((c) => c.type === "number")) return "numberList";
      if (items.every((c) => c.type === "string")) return "stringList";
      return "unknown";
    }
    default:
      return "unknown";
  }
}

function walkJson(node: JsonNode, path: string[], out: ConfigNode[]): void {
  if (node.type === "object") {
    for (const prop of node.children ?? []) {
      const [keyNode, valueNode] = prop.children ?? [];
      if (!keyNode || !valueNode) continue;
      walkJson(valueNode, [...path, String(keyNode.value)], out);
    }
    return;
  }

  // Arrays of scalars are editable as a whole; arrays of objects are not.
  if (node.type === "array") {
    const kind = jsonKind(node);
    if (kind === "unknown") {
      for (const [i, child] of (node.children ?? []).entries()) {
        walkJson(child, [...path, String(i)], out);
      }
      return;
    }
  }

  const key = path[path.length - 1] ?? "";
  out.push({
    path,
    key,
    kind: jsonKind(node),
    value: node.value ?? (node.type === "array"
      ? (node.children ?? []).map((c) => c.value)
      : undefined),
    // Fabric configs rarely carry comments, so this is usually empty — which
    // is exactly why those files fall back to inferred labels in the UI.
    comments: [],
    valueSpan: [node.offset, node.offset + node.length],
  });
}

export const jsonFormat: ConfigFormat = {
  id: "json",
  extensions: [".json", ".json5"],

  parse(text: string): ParsedConfig {
    const errors: ParseError[] = [];
    const tree = parseTree(text, errors, {
      allowTrailingComma: true,
      disallowComments: false,
    });
    if (!tree) return { nodes: [], warning: "File is not valid JSON." };

    const nodes: ConfigNode[] = [];
    walkJson(tree, [], nodes);

    return errors.length > 0
      ? { nodes, warning: `Parsed with ${errors.length} recoverable error(s).` }
      : { nodes };
  },

  literal(value: unknown): string {
    return JSON.stringify(value);
  },
};
