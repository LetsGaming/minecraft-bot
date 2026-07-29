/**
 * Centralised time helpers.
 *
 * Everything the bot *stores* is UTC epoch milliseconds — samples, audit
 * rows, cooldowns, ban expiries. Timezones exist only at the edges, where a
 * human reads a time or a wall-clock schedule fires, and every helper here
 * takes that zone explicitly.
 *
 * It used to come from a single `TZ` environment variable, which made the
 * whole process live in one zone: a bot serving guilds in Berlin and Denver
 * purged both their channels at Berlin midnight. The zone is now a parameter,
 * resolved per guild (Discord-facing) or per schedule (server-facing) — see
 * timezones.ts. UTC is the default everywhere, so anything that forgets to
 * pass one is merely zone-neutral rather than silently wrong for someone.
 *
 * Epoch arithmetic (Date.now(), getTime(), …) is deliberately untouched:
 * those are UTC milliseconds and are correct as they stand.
 */

/** The zone used when a caller has no reason to prefer another. */
export const UTC = "UTC";

/** Is this a zone Intl will accept? Guards config input before it is used. */
export function isValidTimeZone(tz: string): boolean {
  if (tz.trim() === "") return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz }).format(0);
    return true;
  } catch {
    return false;
  }
}

// ── Formatting ────────────────────────────────────────────────────────────

/** "YYYY-MM-DD HH:MM:SS" in `tz`. */
export function formatDatetime(
  date: Date | number = new Date(),
  tz: string = UTC,
): string {
  return new Date(date).toLocaleString("sv-SE", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

/**
 * "YYYY-MM-DD" in `tz`.
 * Use this for day-bucketing rather than toISOString().slice(0,10), which is
 * always UTC and puts a 01:00 Berlin event on the previous day.
 */
export function formatDate(
  date: Date | number = new Date(),
  tz: string = UTC,
): string {
  return new Date(date).toLocaleString("sv-SE", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

/** "HH:MM" in `tz`, for user-facing "ready at …" times. */
export function formatTime(
  date: Date | number = new Date(),
  tz: string = UTC,
): string {
  return new Date(date).toLocaleString("sv-SE", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

// ── Scheduling helpers ────────────────────────────────────────────────────

/**
 * UTC offset in milliseconds for `epochMs` in `tz`.
 * Positive means the zone is ahead of UTC (Berlin in summer = +7_200_000).
 */
function getTzOffsetMs(epochMs: number, tz: string): number {
  const localParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
    .format(new Date(epochMs))
    .replace(",", "")
    .replace(" 24:", " 00:"); // midnight edge case

  return epochMs - new Date(localParts + "Z").getTime();
}

/** Calendar date in `tz` for an epoch, as [year, month(1-12), day]. */
function localDateParts(
  epochMs: number,
  tz: string,
): [year: number, month: number, day: number] {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(new Date(epochMs))
    .split("-")
    .map(Number) as [number, number, number];
}

/**
 * The UTC epoch of the next `hour:minute` in `tz`, strictly after `fromMs`.
 *
 * Built from Intl and Date.UTC only — never `new Date(y, m, d)`, which would
 * quietly use the *system* zone and be off by the difference whenever the
 * container's zone is not the caller's. Date.UTC also normalises overflow
 * (Jan 32 → Feb 1), which the old midnight helper did not: it pasted
 * `day + 1` into an ISO string, so on the last day of every month it built
 * "2026-01-32T00:00:00Z", got Invalid Date, and returned NaN. A NaN delay
 * makes setTimeout fire immediately, so the nightly channel purge misfired
 * every month-end. One code path now serves both, and it is the correct one.
 */
export function nextTimeOfDayEpoch(
  hour: number,
  minute: number,
  tz: string = UTC,
  fromMs: number = Date.now(),
): number {
  const [year, month, day] = localDateParts(fromMs, tz);

  const candidateFor = (dayOffset: number): number => {
    const naive = Date.UTC(year, month - 1, day + dayOffset, hour, minute, 0);
    return naive + getTzOffsetMs(naive, tz);
  };

  const today = candidateFor(0);
  return today > fromMs ? today : candidateFor(1);
}

/** The UTC epoch of the next local midnight in `tz`. */
export function nextMidnightEpoch(
  tz: string = UTC,
  fromMs: number = Date.now(),
): number {
  return nextTimeOfDayEpoch(0, 0, tz, fromMs);
}

/** Milliseconds until the next local midnight in `tz`. */
export function msUntilMidnight(
  tz: string = UTC,
  fromMs: number = Date.now(),
): number {
  return nextMidnightEpoch(tz, fromMs) - fromMs;
}

/** Day of week in `tz` for an epoch, 0–6 with Sunday = 0. */
export function localDayOfWeek(epochMs: number, tz: string = UTC): number {
  const name = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
  }).format(new Date(epochMs));
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(name);
}

/** Hour of day (0–23) in `tz` for an epoch. */
export function localHourOfDay(epochMs: number, tz: string = UTC): number {
  return Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "2-digit",
      hour12: false,
    }).format(new Date(epochMs)),
  );
}
