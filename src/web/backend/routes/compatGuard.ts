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

export const MAX_ACTIVE_GLOBAL = 4;
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
  jobId: string;
  mcVersion: string;
  at: number;
}

interface Remembered {
  job: ModCompatJob;
  at: number;
}

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

  const owner = (server: string, user: string) => `${server}\n${user}`;
  const jobKey = (server: string, jobId: string) => `${server}\n${jobId}`;

  return {
    /**
     * Admission for a start request. Returns the job a user already has for
     * the same version, or throws when the request must be refused.
     */
    admit(
      server: string,
      user: string,
      mcVersion: string,
      refresh: boolean,
    ): { existingJobId: string | null } {
      sweep();
      const mine = active.get(owner(server, user));
      if (mine) {
        if (mine.mcVersion === mcVersion && !refresh) return { existingJobId: mine.jobId };
        throw new CompatLimitError(
          409,
          "You already have a version check running on this server. Wait for it to finish.",
        );
      }
      if (active.size >= MAX_ACTIVE_GLOBAL) {
        throw new CompatLimitError(429, "Too many version checks are running. Try again shortly.");
      }
      if (refresh) {
        const last = refreshedAt.get(server);
        if (last !== undefined && now() - last < REFRESH_MIN_INTERVAL_MS) {
          throw new CompatLimitError(
            429,
            "A refresh was just requested for this server. Wait about 30 seconds.",
          );
        }
      }
      return { existingJobId: null };
    },

    started(server: string, user: string, mcVersion: string, jobId: string, refresh: boolean): void {
      active.set(owner(server, user), { jobId, mcVersion, at: now() });
      evictOldest(active, ACTIVE_MAX_ENTRIES);
      if (refresh) {
        refreshedAt.set(server, now());
        evictOldest(refreshedAt, REFRESH_MAX_ENTRIES);
      }
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
