/**
 * The contract every config format adapter satisfies.
 *
 * One editor across TOML, JSON and .properties only works if every adapter
 * answers the same two questions: what values are in this file, and where
 * exactly does each value sit. That second half is the whole design.
 *
 * ── Why offsets, and not an object ──
 *
 * The obvious adapter is `parse(text) -> object` and `serialize(object) ->
 * text`. It is also unusable here. A NeoForge config looks like this:
 *
 *     #Range: 1 ~ 64
 *     #Allowed Values: PEACEFUL, EASY, NORMAL, HARD
 *     #Default: NORMAL
 *     difficulty = "NORMAL"
 *
 * Those comments are the only documentation the mod author wrote — they are
 * what tells a non-technical person what the setting even means. Round-tripping
 * through an object throws all of them away, along with key order and spacing,
 * and turns every save into a diff that touches the whole file.
 *
 * So adapters report a *span* for each value, and writing means splicing new
 * text over that span. Everything the adapter did not understand — comments,
 * blank lines, formatting, sections it never looked at — is untouched by
 * construction rather than by effort.
 *
 * ── Purity ──
 *
 * Nothing in this directory touches the filesystem or the network. Text goes
 * in, text comes out. That is what makes the adapters testable against
 * hand-written chunk boundaries and awkward real-world files without a server
 * anywhere near them.
 */

/** What kind of value a node holds, for choosing an input control. */
export type ConfigValueKind =
  | "string"
  | "number"
  | "boolean"
  | "stringList"
  | "numberList"
  | "unknown";

/** A single editable value inside a config file. */
export interface ConfigNode {
  /** Path from the document root, e.g. ["general", "spawnRate"]. */
  path: string[];
  /** Display key — the last path segment. */
  key: string;
  kind: ConfigValueKind;
  value: unknown;
  /**
   * The comment block immediately above this key, one entry per line, with
   * the comment marker and leading whitespace stripped.
   *
   * This is where a schema comes from for Forge and NeoForge: those files
   * carry `Range:`, `Allowed Values:` and `Default:` lines here.
   */
  comments: string[];
  /** Byte offsets of the VALUE text only, never the key or the separator. */
  valueSpan: [number, number];
  /** True when the adapter cannot safely rewrite this node (see below). */
  readOnly?: boolean;
}

export interface ParsedConfig {
  nodes: ConfigNode[];
  /**
   * Set when the file parsed with recoverable damage. The editor shows it
   * read-only rather than risking a write against a shape it misread.
   */
  warning?: string;
}

/** One pending change: replace the value at `path` with `value`. */
export interface ConfigEdit {
  path: string[];
  value: unknown;
}

export interface ConfigFormat {
  id: string;
  /** Extensions this adapter claims, lower-case, with the dot. */
  extensions: string[];
  /** Second-chance detection for ambiguous names like `.txt` and `.conf`. */
  detect?: (sample: string) => boolean;
  parse: (text: string) => ParsedConfig;
  /** Render one value as this format's literal syntax. */
  literal: (value: unknown, kind: ConfigValueKind) => string;
}

/** Thrown when an edit cannot be applied safely. Never partially written. */
export class ConfigEditError extends Error {}
