/**
 * Millisecond lengths of the time units, as pure arithmetic. Months and years
 * are the calendar averages (30.44 d / 365.25 d), so a "month" is a rough
 * promise rather than a calendar event.
 */
export const MS = {
  second: 1_000,
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 604_800_000,
  month: 2_629_746_000,
  year: 31_556_952_000,
} as const;
