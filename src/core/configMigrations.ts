/**
 * Config format migrations.
 *
 * Each migrator is a pure function from one parsed config.json to the next
 * format version. loadConfig() runs the pending ones in order, keeps a backup
 * of the original file, and writes the result back, so an operator never has
 * to edit the file for a format change the bot can make itself.
 *
 * A migrator throws ConfigMigrationError when it cannot finish without
 * information only the operator has. Nothing is written in that case.
 */
import { REMOVED_LOCAL_SERVER_FIELDS } from "@mcbot/schema";

/** The format version this build reads and writes. */
export const CURRENT_CONFIG_VERSION = 1;

type RawObject = Record<string, unknown>;

export interface MigrationContext {
  /** Environment used to decide whether a wrapper key is supplied outside the file. */
  env: Record<string, string | undefined>;
}

export interface MigrationOutcome {
  config: RawObject;
  /** What changed, one short line per change. */
  changes: string[];
}

export interface ConfigMigrator {
  from: number;
  to: number;
  describe: string;
  migrate(raw: RawObject, ctx: MigrationContext): MigrationOutcome;
}

export interface AppliedMigration {
  from: number;
  to: number;
  describe: string;
  changes: string[];
}

export interface MigrationResult {
  config: RawObject;
  /** Version found in the file (0 when absent). */
  fromVersion: number;
  applied: AppliedMigration[];
}

/** Thrown when a config cannot be migrated or is not supported by this build. */
export class ConfigMigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigMigrationError";
  }
}

const isObject = (v: unknown): v is RawObject =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isBlank = (v: unknown): boolean =>
  typeof v !== "string" || v.trim() === "";

const envSuffix = (id: string): string =>
  id.toUpperCase().replace(/[^A-Z0-9]/g, "_");

/**
 * Put `configVersion` right after `$schema` (or first) so the key stays at
 * the top of the file where an operator looks for it. An existing key keeps
 * its position.
 */
export function stampConfigVersion<T extends object>(
  config: T,
  version: number = CURRENT_CONFIG_VERSION,
): T & { configVersion: number } {
  const entries = Object.entries(config);
  if ("configVersion" in config) {
    return Object.fromEntries(
      entries.map(([k, v]) => [k, k === "configVersion" ? version : v]),
    ) as T & { configVersion: number };
  }
  const schemaEntry = entries.filter(([k]) => k === "$schema");
  const rest = entries.filter(([k]) => k !== "$schema");
  return Object.fromEntries([
    ...schemaEntry,
    ["configVersion", version],
    ...rest,
  ]) as T & { configVersion: number };
}

function describeMissing(
  missing: Array<{ id: string; apiUrl: boolean; apiKey: boolean }>,
  stripped: string[],
  flat: boolean,
): string {
  const lines = missing.flatMap(({ id, apiUrl, apiKey }) => [
    ...(apiUrl
      ? [
          `  - servers.${id}.apiUrl: the base URL of the API wrapper on the ` +
            `Minecraft host, e.g. "http://192.168.1.10:3030"`,
        ]
      : []),
    ...(apiKey
      ? [
          `  - servers.${id}.apiKey: the wrapper's shared secret (or set ` +
            `API_KEY_${envSuffix(id)} / API_KEY in the environment)`,
        ]
      : []),
  ]);
  return (
    (flat
      ? "This is the pre-5.0.0 single-server format (local-mode fields at the top level)."
      : "This config still describes local-mode servers (removed in 5.0.0).") +
    " The bot now reaches every server through an API wrapper, and a wrapper " +
    "address cannot be guessed, so config.json was left unchanged. Add:\n" +
    lines.join("\n") +
    `\nThen restart; the local-mode fields (${stripped.join(", ")}) are removed ` +
    "automatically. Move their values into the wrapper's own config on the " +
    "Minecraft host. See docs/admin/migrating-to-5.md; 4.3.x is the last " +
    "release that supported local deployment."
  );
}

const removeLocalMode: ConfigMigrator = {
  from: 0,
  to: 1,
  describe: "remove local-mode server fields and wrap a flat single-server config",
  migrate(input, ctx) {
    const config: RawObject = structuredClone(input);
    const changes: string[] = [];
    const strippedAll = new Set<string>();
    const missing: Array<{ id: string; apiUrl: boolean; apiKey: boolean }> = [];
    let flat = false;

    const stripLocal = (target: RawObject): string[] => {
      const found = REMOVED_LOCAL_SERVER_FIELDS.filter((f) => f in target);
      for (const f of found) {
        delete target[f];
        strippedAll.add(f);
      }
      return found;
    };

    if (config.servers === undefined) {
      const server: RawObject = {};
      const rootLocal = REMOVED_LOCAL_SERVER_FIELDS.filter((f) => f in config);
      if (rootLocal.length > 0) {
        flat = true;
        for (const key of ["apiUrl", "apiKey"]) {
          if (key in config) {
            server[key] = config[key];
            delete config[key];
          }
        }
        stripLocal(config);
        config.servers = { default: server };
        changes.push(
          `moved the top-level single-server settings into servers.default ` +
            `and removed ${rootLocal.join(", ")}`,
        );
        missing.push({
          id: "default",
          apiUrl: isBlank(server.apiUrl),
          apiKey:
            isBlank(server.apiKey) &&
            isBlank(ctx.env.API_KEY_DEFAULT) &&
            isBlank(ctx.env.API_KEY),
        });
      }
    } else if (isObject(config.servers)) {
      for (const [id, entry] of Object.entries(config.servers)) {
        if (!isObject(entry)) continue;
        const removed = stripLocal(entry);
        if (removed.length === 0) continue;
        changes.push(`servers.${id}: removed ${removed.join(", ")}`);
        missing.push({
          id,
          apiUrl: isBlank(entry.apiUrl),
          apiKey:
            isBlank(entry.apiKey) &&
            isBlank(ctx.env[`API_KEY_${envSuffix(id)}`]) &&
            isBlank(ctx.env.API_KEY),
        });
      }
    }

    const blockers = missing.filter((m) => m.apiUrl || m.apiKey);
    if (blockers.length > 0) {
      throw new ConfigMigrationError(
        describeMissing(blockers, [...strippedAll], flat),
      );
    }
    return { config, changes };
  },
};

export const CONFIG_MIGRATORS: readonly ConfigMigrator[] = [removeLocalMode];

/** Version recorded in a parsed config; 0 when absent. */
export function readConfigVersion(raw: RawObject): number {
  const v = raw.configVersion;
  if (v === undefined) return 0;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
    throw new ConfigMigrationError(
      `configVersion must be a whole number of 0 or more (found ${JSON.stringify(v)}).`,
    );
  }
  return v;
}

/**
 * Bring a parsed config up to CURRENT_CONFIG_VERSION. Returns the input
 * untouched (same reference, `applied` empty) when it is already current.
 */
export function runConfigMigrations(
  raw: unknown,
  ctx: MigrationContext = { env: process.env },
  migrators: readonly ConfigMigrator[] = CONFIG_MIGRATORS,
  target: number = CURRENT_CONFIG_VERSION,
): MigrationResult {
  if (!isObject(raw)) {
    throw new ConfigMigrationError("config root must be a JSON object.");
  }
  const fromVersion = readConfigVersion(raw);
  if (fromVersion > target) {
    throw new ConfigMigrationError(
      `config.json has configVersion ${fromVersion}, but this bot only ` +
        `understands up to ${target}. It was written by a newer release; ` +
        `update the bot instead of downgrading the file.`,
    );
  }

  let config: RawObject = raw;
  let version = fromVersion;
  const applied: AppliedMigration[] = [];
  while (version < target) {
    const step = migrators.find((m) => m.from === version);
    if (!step) {
      throw new ConfigMigrationError(
        `no migration from configVersion ${version} to ${target}.`,
      );
    }
    const outcome = step.migrate(config, ctx);
    config = outcome.config;
    version = step.to;
    applied.push({
      from: step.from,
      to: step.to,
      describe: step.describe,
      changes: outcome.changes,
    });
  }

  if (applied.length === 0) return { config: raw, fromVersion, applied };
  return { config: stampConfigVersion(config, target), fromVersion, applied };
}
