/**
 * Bookkeeping that keeps the compatibility check cheap for the wrapper and for
 * this process: who has a job running, how often a refresh may be asked for,
 * and a bounded memory of job states so polling does not call the wrapper
 * once a job has finished.
 *
 * Every map here has a maximum size and an age cap, so cycling through
 * versions, users or job ids cannot grow memory.
 */
import type { ModCompatJob } from "@mcbot/core/utils/server/serverAccess.js";

export const MAX_ACTIVE_PER_SERVER = 2;
export const MAX_ACTIVE_PER_TENANT = 2;
/** Backstop only: roughly three tenants' worth, so it trips under real overload, not under one tenant. */
export const MAX_ACTIVE_GLOBAL = 6;
export const REFRESH_MIN_INTERVAL_MS = 30_000;
export const ACTIVE_MAX_AGE_MS = 20 * 60_000;
export const JOB_MEMORY_MAX_AGE_MS = 15 * 60_000;
export const JOB_MEMORY_MAX_ENTRIES = 100;
/** A running job is re-read from the wrapper at most this often, however many tabs poll it. */
export const RUNNING_REUSE_MS = 800;
const ACTIVE_MAX_ENTRIES = 200;
const REFRESH_MAX_ENTRIES = 100;

export class CompatLimitError extends Error {
  readonly statusCode: 409 | 429;
  constructor(statusCode: 409 | 429, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

interface Active {
  server: string;
  tenant: string;
  /** Null while the wrapper is still being asked. */
  jobId: string | null;
  mcVersion: string;
  at: number;
  settled: Promise<{ jobId: string }>;
}

interface Remembered {
  job: ModCompatJob;
  at: number;
}

export type Reservation =
  | { kind: "existing"; settled: Promise<{ jobId: string }> }
  | {
      kind: "new";
      /** The wrapper accepted the start; the reservation now names the real job. */
      commit(jobId: string): void;
      /** The wrapper refused or failed; free the slot and the refresh timestamp. */
      rollback(err: unknown): void;
    };

function evictOldest<V>(map: Map<string, V>, max: number): void {
  while (map.size > max) map.delete(map.keys().next().value as string);
}

export function createCompatGuard(now: () => number = Date.now) {
  const active = new Map<string, Active>();
  const refreshedAt = new Map<string, number>();
  const jobs = new Map<string, Remembered>();

  function sweep(): void {
    const t = now();
    for (const [k, v] of active) if (t - v.at > ACTIVE_MAX_AGE_MS) active.delete(k);
    for (const [k, v] of jobs) if (t - v.at > JOB_MEMORY_MAX_AGE_MS) jobs.delete(k);
    for (const [k, at] of refreshedAt) if (t - at > REFRESH_MIN_INTERVAL_MS) refreshedAt.delete(k);
  }

  const owner = (server: string, user: string) => `${server}
${user}`;
  const jobKey = (server: string, jobId: string) => `${server}
${jobId}`;

  function countWhere(pred: (a: Active) => boolean): number {
    let n = 0;
    for (const a of active.values()) if (pred(a)) n++;
    return n;
  }

  return {
    /**
     * Admission and reservation in one synchronous step, so concurrent
     * requests cannot all pass a check that none of them has yet counted
     * against. A new reservation counts toward every limit immediately; the
     * caller commits it with the real job id or rolls it back.
     */
    reserve(
      server: string,
      user: string,
      tenant: string,
      mcVersion: string,
      refresh: boolean,
    ): Reservation {
      sweep();
      const key = owner(server, user);
      const mine = active.get(key);
      if (mine) {
        if (mine.mcVersion === mcVersion && !refresh) {
          return { kind: "existing", settled: mine.settled };
        }
        throw new CompatLimitError(
          409,
          "You already have a version check running on this server. Wait for it to finish.",
        );
      }
      if (countWhere((a) => a.server === server) >= MAX_ACTIVE_PER_SERVER) {
        throw new CompatLimitError(
          429,
          "This server already has the most version checks it allows running. Try again shortly.",
        );
      }
      if (countWhere((a) => a.tenant === tenant) >= MAX_ACTIVE_PER_TENANT) {
        throw new CompatLimitError(
          429,
          "Your guild already has the most version checks it allows running. Try again shortly.",
        );
      }
      if (active.size >= MAX_ACTIVE_GLOBAL) {
        throw new CompatLimitError(
          429,
          "The dashboard is busy with version checks across all guilds. Try again shortly.",
        );
      }
      const previousRefresh = refreshedAt.get(server);
      if (refresh && previousRefresh !== undefined && now() - previousRefresh < REFRESH_MIN_INTERVAL_MS) {
        throw new CompatLimitError(
          429,
          "A refresh was just requested for this server. Wait about 30 seconds.",
        );
      }

      let resolve!: (v: { jobId: string }) => void;
      let reject!: (e: unknown) => void;
      const settled = new Promise<{ jobId: string }>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      settled.catch(() => undefined);
      const entry: Active = { server, tenant, jobId: null, mcVersion, at: now(), settled };
      active.set(key, entry);
      evictOldest(active, ACTIVE_MAX_ENTRIES);
      if (refresh) {
        refreshedAt.set(server, now());
        evictOldest(refreshedAt, REFRESH_MAX_ENTRIES);
      }

      return {
        kind: "new",
        commit(jobId) {
          entry.jobId = jobId;
          resolve({ jobId });
        },
        rollback(err) {
          if (active.get(key) === entry) active.delete(key);
          if (refresh) {
            if (previousRefresh === undefined) refreshedAt.delete(server);
            else refreshedAt.set(server, previousRefresh);
          }
          reject(err);
        },
      };
    },

    /** Remembered state of a job, or null when the wrapper has to be asked. */
    recall(server: string, jobId: string): ModCompatJob | null {
      sweep();
      const hit = jobs.get(jobKey(server, jobId));
      if (!hit) return null;
      if (hit.job.state !== "running") return hit.job;
      return now() - hit.at < RUNNING_REUSE_MS ? hit.job : null;
    },

    /** Records a job read from the wrapper; a finished job frees its owner's slot. */
    observe(server: string, job: ModCompatJob): void {
      const key = jobKey(server, job.jobId);
      jobs.delete(key);
      jobs.set(key, { job, at: now() });
      evictOldest(jobs, JOB_MEMORY_MAX_ENTRIES);
      if (job.state === "running") return;
      for (const [k, v] of active) if (v.jobId === job.jobId && k.startsWith(`${server}\n`)) active.delete(k);
    },

    /** The wrapper no longer knows the job. */
    forget(server: string, jobId: string): void {
      jobs.delete(jobKey(server, jobId));
      for (const [k, v] of active) if (v.jobId === jobId && k.startsWith(`${server}\n`)) active.delete(k);
    },

    sizes: () => ({ active: active.size, jobs: jobs.size, refreshed: refreshedAt.size }),
  };
}

export type CompatGuard = ReturnType<typeof createCompatGuard>;
