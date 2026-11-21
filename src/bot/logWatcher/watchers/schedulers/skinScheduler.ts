/**
 * Keeps each known player's skin hash current, so a head shows the skin the
 * player wears now (see skinResolver.ts for why).
 *
 * Every sweep covers the players seen in the last 60 days plus the linked
 * accounts, one at a time and spaced out, because Mojang rate-limits. A player
 * is asked at most once an hour; a join checks sooner (joinLeave.ts). The first
 * sweep runs shortly after start, so a bad head is fixed within a minute of a
 * deploy.
 */
import { MS } from "@mcbot/schema";
import { log } from "@mcbot/core/utils/logger.js";
import { loadLinkedAccountsOrEmpty } from "@mcbot/core/utils/stores/linkStore.js";
import { recentPlayerNames } from "@mcbot/core/utils/stores/sessionStore.js";
import { pruneSkins } from "@mcbot/core/utils/stores/headStore.js";
import { refreshSkins, type SweepSummary } from "@mcbot/core/utils/minecraft/skinResolver.js";
import { startPoller, type Poller } from "../poller.js";

const SWEEP_INTERVAL_MS = 30 * MS.minute;
const SWEEP_START_DELAY_MS = 30 * MS.second;
/** A little under the hour, so a player is asked on every second sweep and not skipped by a few seconds. */
const SKIN_MAX_AGE_MS = 55 * MS.minute;
const ACTIVE_WINDOW_MS = 60 * MS.day;
const SPACING_MS = 1_500;

/** The players a sweep covers, one name per player. Exported for tests. */
export async function sweepNames(now: number = Date.now()): Promise<string[]> {
  const names = new Map<string, string>();
  for (const name of recentPlayerNames(now - ACTIVE_WINDOW_MS)) names.set(name.toLowerCase(), name);
  for (const name of Object.values(await loadLinkedAccountsOrEmpty())) {
    if (!names.has(name.toLowerCase())) names.set(name.toLowerCase(), name);
  }
  return [...names.values()];
}

/** One sweep. Exported for tests; the scheduler calls it on an interval. */
export async function runSkinSweep(now: number = Date.now()): Promise<SweepSummary> {
  const names = await sweepNames(now);
  pruneSkins(names);
  const summary = await refreshSkins(names, { maxAgeMs: SKIN_MAX_AGE_MS, spacingMs: SPACING_MS });
  if (summary.asked > 0 || summary.stoppedEarly) {
    log.info(
      "skins",
      `Skin sweep: asked ${summary.asked}, changed ${summary.changed}, failed ${summary.failed}, ` +
        `skipped ${summary.skipped}${summary.stoppedEarly ? ", stopped early (Mojang asked to slow down)" : ""}.`,
    );
  }
  return summary;
}

export function startSkinScheduler(): Poller {
  const poller = startPoller(
    "skins",
    async () => {
      await runSkinSweep();
    },
    SWEEP_INTERVAL_MS,
    { unref: true, initialDelayMs: SWEEP_START_DELAY_MS },
  );
  log.info("skins", `Skin sweep active (every ${SWEEP_INTERVAL_MS / MS.minute} min)`);
  return poller;
}
