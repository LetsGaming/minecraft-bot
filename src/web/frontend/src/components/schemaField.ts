/**
 * Pure schema helpers for the config form's field renderer (SchemaField.vue).
 *
 * Kept dependency-free (no Vue) so the decisions that drive the UI — which
 * control a schema node maps to, resolving `$ref`s, collapsing "one or many"
 * unions, and finding a map's value / an array's item schema — are unit-tested
 * directly. The whole point is to render a real typed input wherever the schema
 * allows it and fall back to raw JSON only as a genuine last resort.
 */

export interface JsonSchemaNode {
  type?: string | string[];
  enum?: unknown[];
  description?: string;
  properties?: Record<string, unknown>;
  additionalProperties?: unknown;
  items?: unknown;
  anyOf?: unknown[];
  oneOf?: unknown[];
  $ref?: string;
}

export type Definitions = Record<string, unknown> | undefined;

/** The controls the form can render. Everything else falls back to JSON. */
export type FieldKind =
  | "boolean"
  | "enum"
  | "string"
  | "number"
  | "object"
  | "map" // Record<string, X> — key/value editor (MapField)
  | "multiselect" // array of a fixed enum (e.g. notification events)
  | "chips" // array of free-form strings (e.g. adminUsers, a ServerScope list)
  | "numberList" // array of numbers (e.g. warnMinutes, milestones)
  | "array" // array of objects — item-list editor (ArrayField)
  | "json"; // genuine last resort

/** Follow `#/definitions/*` refs to the concrete node (cycle-guarded). */
export function derefNode(node: unknown, defs: Definitions): JsonSchemaNode {
  let n = (node ?? {}) as JsonSchemaNode;
  let guard = 0;
  while (n && typeof n.$ref === "string" && guard++ < 20) {
    const key = /^#\/definitions\/(.+)$/.exec(n.$ref)?.[1];
    n = (key && defs && defs[key] ? defs[key] : {}) as JsonSchemaNode;
  }
  return n;
}

function firstType(node: JsonSchemaNode): string | undefined {
  if (!Array.isArray(node.type)) return node.type;
  // Optional fields serialise as e.g. ["string","null"] — the meaningful type
  // is the non-null one.
  return node.type.find((t) => t !== "null") ?? node.type[0];
}

/**
 * Collapse an "X or X[]" union (anyOf/oneOf with a single-value branch and a
 * matching array branch, in either order) into a plain array-of-X node, so the
 * common "one or many" pattern (ServerScope = string|string[], chatBridge =
 * obj|obj[]) renders as a list instead of raw JSON. Other unions pass through.
 */
export function normalizeNode(node: unknown, defs: Definitions): JsonSchemaNode {
  const n = derefNode(node, defs);
  const union = n.anyOf ?? n.oneOf;
  if (Array.isArray(union) && union.length === 2) {
    const a = derefNode(union[0], defs);
    const b = derefNode(union[1], defs);
    const arr = firstType(a) === "array" ? a : firstType(b) === "array" ? b : null;
    const single = arr === a ? b : arr === b ? a : null;
    if (arr && single) {
      const item = derefNode(arr.items, defs);
      const itemT = firstType(item);
      // Collapse when the array's item is the same shape as the single branch.
      if (itemT === firstType(single) || itemT === "object" || item.enum) {
        return { type: "array", items: arr.items, description: n.description };
      }
    }
  }
  return n;
}

function isSchemaObject(v: unknown): boolean {
  return typeof v === "object" && v !== null;
}

/** Which control to render for a schema node (refs + unions resolved). */
export function classifyField(node: JsonSchemaNode, defs: Definitions): FieldKind {
  const n = normalizeNode(node, defs);
  if ((n.enum?.length ?? 0) > 0) return "enum";
  const type = firstType(n);
  if (type === "boolean") return "boolean";
  if (type === "string") return "string";
  if (type === "number" || type === "integer") return "number";
  if (type === "object" && n.properties) return "object";
  if (type === "object" && !n.properties && isSchemaObject(n.additionalProperties)) {
    return "map";
  }
  if (type === "array") {
    const items = derefNode(n.items, defs);
    if ((items.enum?.length ?? 0) > 0) return "multiselect";
    const it = firstType(items);
    if (it === "string") return "chips";
    if (it === "number" || it === "integer") return "numberList";
    if (it === "object") return "array";
  }
  return "json";
}

/** Options for a fixed-enum array field's multiselect. */
export function arrayEnumOptions(
  node: JsonSchemaNode,
  defs: Definitions,
): { value: unknown; label: string }[] {
  const items = derefNode(normalizeNode(node, defs).items, defs);
  return (items.enum ?? []).map((v) => ({ value: v, label: String(v) }));
}

/** The value schema for a Record<string, X> map node. */
export function mapValueSchema(
  node: JsonSchemaNode,
  defs: Definitions,
): JsonSchemaNode {
  return derefNode(normalizeNode(node, defs).additionalProperties, defs);
}

/** The item schema for an array (or a collapsed X|X[]) node. */
export function arrayItemSchema(
  node: JsonSchemaNode,
  defs: Definitions,
): JsonSchemaNode {
  return derefNode(normalizeNode(node, defs).items, defs);
}

/** Kinds of entity a field references by ID (rendered as a named dropdown). */
export type RefKind = "server" | "channel" | "role";

/**
 * Whether a field holds an ID reference to a known entity, by field name — so
 * it can render a name dropdown instead of a raw-ID text box. Names are
 * consistent in the schema: `*channelId` → channel, `*Role` (mentionRole,
 * linkedRole) → role, `server` / `defaultServer` / `allowedServers` (all
 * ServerScope) → server. Fields that mix IDs (e.g. adminUsers = users AND
 * roles) intentionally don't match and stay free-form.
 */
export function referenceKind(name: string): RefKind | null {
  const n = name.toLowerCase();
  if (/channelid$/.test(n)) return "channel";
  if (/role$/.test(n)) return "role";
  if (n === "server" || n === "defaultserver" || n === "allowedservers") {
    return "server";
  }
  return null;
}
