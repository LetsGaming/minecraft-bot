/**
 * Adapters for the two formats either side of TOML.
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
import type {
  ConfigFormat,
  ConfigNode,
  ConfigValueKind,
  ParsedConfig,
} from "./types.js";

// ── .properties ──────────────────────────────────────────────────────────────

/**
 * `key=value`, capturing where the value starts.
 *
 * Note there is no trailing-comment handling: in a properties file a `#` is
 * only a comment at the start of a line, so `motd=Welcome # home` has a `#`
 * in the motd and stripping it would silently change the server's greeting.
 */
const PROP_ENTRY_RE = /^([^#!=:\s][^=:]*?)(\s*[=:]\s*)(.*)$/;

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
    let comments: string[] = [];
    let offset = 0;

    for (const rawLine of text.split("\n")) {
      const lineStart = offset;
      offset += rawLine.length + 1;

      const line = rawLine.replace(/\r$/, "");
      const trimmed = line.trim();

      if (trimmed === "") {
        comments = [];
        continue;
      }
      if (trimmed.startsWith("#") || trimmed.startsWith("!")) {
        comments.push(trimmed.replace(/^[#!]+\s?/, ""));
        continue;
      }

      const entry = PROP_ENTRY_RE.exec(line);
      if (!entry) {
        comments = [];
        continue;
      }

      const [, key = "", separator = "", value = ""] = entry;
      const valueStart = lineStart + key.length + separator.length;
      const kind = inferPropertyKind(value);

      nodes.push({
        path: [key.trim()],
        key: key.trim(),
        kind,
        value:
          kind === "boolean"
            ? value.trim() === "true"
            : kind === "number"
              ? Number(value.trim())
              : value,
        comments: [...comments],
        valueSpan: [valueStart, valueStart + value.length],
      });
      comments = [];
    }

    return { nodes };
  },

  /**
   * Values are written raw. A properties value runs to end of line and has no
   * quoting, so quoting it would put literal quote characters into the file —
   * a `motd` of `"Hello"` instead of `Hello`.
   */
  literal(value: unknown, kind: ConfigValueKind): string {
    if (kind === "boolean") return value ? "true" : "false";
    if (Array.isArray(value)) return value.join(",");
    return String(value ?? "");
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

  literal(value: unknown, kind: ConfigValueKind): string {
    if (kind === "unknown") return JSON.stringify(value);
    return JSON.stringify(value);
  },
};
