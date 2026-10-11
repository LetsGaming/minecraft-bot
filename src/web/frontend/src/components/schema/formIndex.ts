/**
 * The schema form as a flat index, for the parts of an editor that need the
 * whole picture at once: the filter and its count, the group list, the jump
 * to the first problem, server errors placed on their field, and the review
 * list. The form itself renders recursively (SchemaField, MapField,
 * ArrayField); `walkFields` reads the same schema and value, so both agree on
 * every path. Dependency-free, like schemaField.ts.
 */
import {
  arrayItemSchema,
  classifyField,
  derefNode,
  humanizeKey,
  mapValueSchema,
  type Definitions,
  type FieldKind,
  type JsonSchemaNode,
} from "./schemaField";

function isPlainRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function hasType(node: JsonSchemaNode, t: string): boolean {
  return Array.isArray(node.type) ? node.type.includes(t) : node.type === t;
}

/** Title, help and effect of a property. They may sit beside a `$ref`, so the outer node is read first. */
export function fieldText(
  outer: unknown,
  defs: Definitions,
): { title?: string; description: string; effect: string } {
  const own = (outer ?? {}) as JsonSchemaNode;
  const node = derefNode(outer, defs);
  return {
    title: own.title ?? node.title,
    description: own.description ?? node.description ?? "",
    effect: own.effect ?? node.effect ?? "",
  };
}

export interface FieldEntry {
  /** Real config keys, from the document root. */
  path: string[];
  label: string;
  description: string;
  kind: FieldKind;
  /** Renders one control, no nested fields. */
  leaf: boolean;
  node: JsonSchemaNode;
  value: unknown;
}

export interface WalkOptions {
  /** Display name of a map entry (a guild's name for its ID). */
  entryLabel?: (mapName: string, key: string) => string | undefined;
}

export function walkFields(
  props: Record<string, unknown>,
  value: unknown,
  defs: Definitions,
  base: string[] = [],
  options: WalkOptions = {},
): FieldEntry[] {
  const out: FieldEntry[] = [];
  const doc = isPlainRecord(value) ? value : {};
  for (const [key, schema] of Object.entries(props)) {
    walkOne(schema, key, humanizeKey(key), [...base, key], doc[key], defs, options, out);
  }
  return out;
}

function walkOne(
  schema: unknown,
  name: string,
  fallbackLabel: string,
  path: string[],
  value: unknown,
  defs: Definitions,
  options: WalkOptions,
  out: FieldEntry[],
): void {
  const node = derefNode(schema, defs);
  const text = fieldText(schema, defs);
  const kind = classifyField(node, defs);
  const leaf = kind !== "object" && kind !== "map" && kind !== "array";
  out.push({ path, label: text.title ?? fallbackLabel, description: text.description, kind, leaf, node, value });
  if (kind === "object") {
    const record = isPlainRecord(value) ? value : {};
    for (const [key, child] of Object.entries(node.properties ?? {})) {
      walkOne(child, key, humanizeKey(key), [...path, key], record[key], defs, options, out);
    }
  } else if (kind === "map") {
    const record = isPlainRecord(value) ? value : {};
    const valueSchema = mapValueSchema(node, defs);
    for (const key of Object.keys(record)) {
      const label = options.entryLabel?.(name, key) ?? key;
      walkOne(valueSchema, key, label, [...path, key], record[key], defs, options, out);
    }
  } else if (kind === "array") {
    const items = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
    const itemSchema = arrayItemSchema(node, defs);
    items.forEach((item, i) => {
      walkOne(itemSchema, String(i), `#${i + 1}`, [...path, String(i)], item, defs, options, out);
    });
  }
}

export const pathKeyOf = (path: readonly string[]): string => JSON.stringify(path);

export interface FieldFilter {
  active: boolean;
  isVisible(path: readonly string[]): boolean;
  /** Leaf fields shown. */
  count: number;
}

/**
 * Which fields a filter shows. A field matches on its label, key path or help
 * text, with every word of the query found somewhere. A match shows its
 * ancestors, so it has a place to render, and everything under it, so a
 * matching section is shown whole.
 */
export function filterFields(entries: readonly FieldEntry[], query: string): FieldFilter {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return { active: false, isVisible: () => true, count: entries.filter((e) => e.leaf).length };
  }
  const matched = new Set<string>();
  const shown = new Set<string>();
  for (const entry of entries) {
    const hay = `${entry.label} ${entry.path.join(".")} ${entry.description}`.toLowerCase();
    if (!words.every((w) => hay.includes(w))) continue;
    matched.add(pathKeyOf(entry.path));
    for (let i = 1; i <= entry.path.length; i++) shown.add(pathKeyOf(entry.path.slice(0, i)));
  }
  const isVisible = (path: readonly string[]): boolean => {
    if (shown.has(pathKeyOf(path))) return true;
    for (let i = 1; i < path.length; i++) if (matched.has(pathKeyOf(path.slice(0, i)))) return true;
    return false;
  };
  return { active: true, isVisible, count: entries.filter((e) => e.leaf && isVisible(e.path)).length };
}

export interface FieldProblem {
  key: "field.belowMin" | "field.aboveMax" | "field.notAbove" | "field.notBelow" | "field.notInteger" | "field.pattern";
  vars: Record<string, string | number>;
}

/** What is wrong with a value by its own schema node, before the server sees it. */
export function fieldProblem(node: JsonSchemaNode, value: unknown): FieldProblem | null {
  if (typeof value === "number") {
    if (hasType(node, "integer") && !Number.isInteger(value)) return { key: "field.notInteger", vars: {} };
    if (node.minimum !== undefined && value < node.minimum) return { key: "field.belowMin", vars: { min: node.minimum } };
    if (node.exclusiveMinimum !== undefined && value <= node.exclusiveMinimum) {
      return { key: "field.notAbove", vars: { min: node.exclusiveMinimum } };
    }
    if (node.maximum !== undefined && value > node.maximum) return { key: "field.aboveMax", vars: { max: node.maximum } };
    if (node.exclusiveMaximum !== undefined && value >= node.exclusiveMaximum) {
      return { key: "field.notBelow", vars: { max: node.exclusiveMaximum } };
    }
  }
  if (typeof value === "string" && value !== "" && node.pattern) {
    try {
      if (!new RegExp(node.pattern).test(value)) return { key: "field.pattern", vars: { pattern: node.pattern } };
    } catch {
      return null;
    }
  }
  return null;
}

export interface AttachedErrors {
  /** Path key (see pathKeyOf) to its messages. */
  byPath: Map<string, string[]>;
  /** Lines that name no field the form shows. */
  general: string[];
}

/**
 * Put server validation lines on the field they name, or on the nearest
 * field above it that the form shows. `strip` maps a reported path into the
 * form's own (a guild editor drops `guilds.<id>`).
 */
export function attachErrors(
  entries: readonly FieldEntry[],
  lines: readonly string[],
  parse: (line: string) => { path: string[]; message: string } | null,
  strip: (path: string[]) => string[] = (p) => p,
): AttachedErrors {
  const known = new Set(entries.map((e) => pathKeyOf(e.path)));
  const byPath = new Map<string, string[]>();
  const general: string[] = [];
  for (const line of lines) {
    const parsed = parse(line);
    const path = parsed ? strip(parsed.path) : [];
    let depth = path.length;
    while (depth > 0 && !known.has(pathKeyOf(path.slice(0, depth)))) depth--;
    if (!parsed || depth === 0) {
      general.push(line.replace(/^\s*-\s*/, ""));
      continue;
    }
    const rest = path.slice(depth);
    const at = pathKeyOf(path.slice(0, depth));
    const list = byPath.get(at) ?? [];
    list.push(rest.length ? `${rest.join(".")}: ${parsed.message}` : parsed.message);
    byPath.set(at, list);
  }
  return { byPath, general };
}

export interface DocChange {
  path: string[];
  before: unknown;
  after: unknown;
}

function stableJson(value: unknown): string {
  return (
    JSON.stringify(value, (_key, v: unknown) =>
      isPlainRecord(v)
        ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
        : v,
    ) ?? "undefined"
  );
}

export function sameValue(a: unknown, b: unknown): boolean {
  return stableJson(a) === stableJson(b);
}

/** Every leaf that differs between two documents. Objects recurse, lists compare whole. */
export function diffDocs(before: unknown, after: unknown, path: string[] = []): DocChange[] {
  if (isPlainRecord(before) && isPlainRecord(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
    return keys.flatMap((key) => diffDocs(before[key], after[key], [...path, key]));
  }
  return sameValue(before, after) ? [] : [{ path, before, after }];
}

export function valueAt(doc: unknown, path: readonly string[]): unknown {
  let cur: unknown = doc;
  for (const key of path) {
    if (isPlainRecord(cur)) cur = cur[key];
    else if (Array.isArray(cur)) cur = cur[Number(key)];
    else return undefined;
  }
  return cur;
}

/** A DOM id for a field path, stable across renders. */
export function fieldDomId(prefix: string, path: readonly string[]): string {
  return `${prefix}-${path.map((p) => p.replace(/[^A-Za-z0-9_-]/g, "_")).join("-")}`;
}
