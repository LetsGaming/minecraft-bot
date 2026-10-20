/**
 * One random secret per relay group, the key of the HMAC that gives unlinked
 * speakers a stable tag. Lives in kv_store["relaySecrets"], never in config or
 * logs, and a secret never leaves the group it belongs to.
 */
import { randomBytes } from "node:crypto";
import { kvMutate } from "../../db/kv.js";

interface RelaySecrets {
  groups: Record<string, string>;
}

function normalize(raw: unknown): RelaySecrets {
  const doc = (typeof raw === "object" && raw !== null ? raw : {}) as Partial<RelaySecrets>;
  return { groups: doc.groups && typeof doc.groups === "object" ? doc.groups : {} };
}

/** The group's secret, created on first use so tags stay stable across restarts. */
export function relayGroupSecret(group: string): string {
  return kvMutate("relaySecrets", normalize, (store) => {
    store.groups[group] ??= randomBytes(32).toString("hex");
    return store.groups[group]!;
  });
}
