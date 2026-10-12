import { computed, provide, ref, type InjectionKey } from "vue";
import { isSecretConfigPath } from "@mcbot/schema";
import type { Definitions } from "../components/schema/schemaField";
import {
  attachErrors,
  diffDocs,
  fieldDomId,
  fieldProblem,
  filterFields,
  pathKeyOf,
  valueAt,
  walkFields,
  type DocChange,
} from "../components/schema/formIndex";
import { parseFieldError } from "../utils/fieldErrors";
import { t } from "../i18n";
import type { EditConflict } from "./useModConfigs";

/**
 * What every field of a schema form asks its editor: is it shown, what was
 * its saved value, what is wrong with it, is it locked. Provided by the
 * editor (Config, the guild dialog), injected by SchemaField at any depth.
 * Without a provider a field renders on its own, as before.
 */
export interface SchemaFormContext {
  isVisible(path: readonly string[]): boolean;
  filtering(): boolean;
  /** The value last saved, when the editor knows it. */
  baselineAt(path: readonly string[]): { known: boolean; value: unknown };
  errorFor(path: readonly string[]): string;
  /** A problem anywhere under this path, so its section opens. */
  hasProblemUnder(path: readonly string[]): boolean;
  conflictAt(path: readonly string[]): boolean;
  /** Sections the editor opened on purpose (jump to a problem). */
  isRevealed(path: readonly string[]): boolean;
  locked(): boolean;
  isSecret(path: readonly string[]): boolean;
  idFor(path: readonly string[]): string;
}

export const SchemaFormKey: InjectionKey<SchemaFormContext> = Symbol("schemaForm");

export interface SchemaFormSource {
  props: () => Record<string, unknown>;
  definitions: () => Definitions;
  draft: () => unknown;
  baseline: () => unknown;
  serverErrors: () => readonly string[];
  conflicts: () => readonly EditConflict[];
  query: () => string;
  locked: () => boolean;
  /** Maps a reported error path into the form's own paths. */
  stripPath?: (path: string[]) => string[];
  entryLabel?: (mapName: string, key: string) => string | undefined;
  /** Secrets by path. Default: the config.json secrets. */
  isSecret?: (path: readonly string[]) => boolean;
  idPrefix: string;
}

export interface FieldIssue {
  path: string[];
  message: string;
}

export function useSchemaForm(source: SchemaFormSource) {
  const revealed = ref<Set<string>>(new Set());

  const entries = computed(() =>
    walkFields(source.props(), source.draft(), source.definitions(), [], {
      entryLabel: source.entryLabel,
    }),
  );

  const filter = computed(() => filterFields(entries.value, source.query()));

  /** Problems the form can see before saving; they block Save. */
  const problems = computed<FieldIssue[]>(() =>
    entries.value.flatMap((entry) => {
      if (!entry.leaf) return [];
      const problem = fieldProblem(entry.node, entry.value);
      return problem ? [{ path: entry.path, message: t(problem.key, problem.vars) }] : [];
    }),
  );

  const attached = computed(() =>
    attachErrors(entries.value, source.serverErrors(), parseFieldError, source.stripPath),
  );

  const messages = computed(() => {
    const out = new Map<string, string[]>();
    for (const issue of problems.value) out.set(pathKeyOf(issue.path), [issue.message]);
    for (const [key, list] of attached.value.byPath) out.set(key, [...(out.get(key) ?? []), ...list]);
    return out;
  });

  /** Fields with a message, in form order: the first one is where "Go to first problem" lands. */
  const issues = computed<FieldIssue[]>(() =>
    entries.value
      .filter((entry) => messages.value.has(pathKeyOf(entry.path)))
      .map((entry) => ({ path: entry.path, message: messages.value.get(pathKeyOf(entry.path))!.join(" ") })),
  );

  const problemPrefixes = computed(() => {
    const out = new Set<string>();
    for (const issue of issues.value) {
      for (let i = 1; i < issue.path.length; i++) out.add(pathKeyOf(issue.path.slice(0, i)));
    }
    return out;
  });

  const conflictKeys = computed(
    () => new Set(source.conflicts().map((c) => pathKeyOf(c.keyPath))),
  );

  const changes = computed<DocChange[]>(() => diffDocs(source.baseline() ?? {}, source.draft() ?? {}));

  const isSecret = source.isSecret ?? isSecretConfigPath;

  const context: SchemaFormContext = {
    isVisible: (path) => filter.value.isVisible(path),
    filtering: () => filter.value.active,
    baselineAt: (path) => {
      const base = source.baseline();
      return base ? { known: true, value: valueAt(base, path) } : { known: false, value: undefined };
    },
    errorFor: (path) => (messages.value.get(pathKeyOf(path)) ?? []).join(" "),
    hasProblemUnder: (path) => problemPrefixes.value.has(pathKeyOf(path)),
    conflictAt: (path) => conflictKeys.value.has(pathKeyOf(path)),
    isRevealed: (path) => revealed.value.has(pathKeyOf(path)),
    locked: () => source.locked(),
    isSecret: (path) => isSecret(path),
    idFor: (path) => fieldDomId(source.idPrefix, path),
  };
  provide(SchemaFormKey, context);

  /** Open every section above a field, so it renders before it is focused. */
  function reveal(path: readonly string[]): void {
    const next = new Set(revealed.value);
    for (let i = 1; i < path.length; i++) next.add(pathKeyOf(path.slice(0, i)));
    revealed.value = next;
  }

  return {
    entries,
    filter,
    problems,
    issues,
    generalErrors: computed(() => attached.value.general),
    changes,
    context,
    reveal,
  };
}
