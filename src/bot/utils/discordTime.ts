/** Discord renders `<t:seconds:R>` in each reader's own locale and clock. */
export function formatLastSeen(ms: number): string {
  return `<t:${Math.floor(ms / 1000)}:R>`;
}

/** Discord renders `<t:seconds:t>` as a short clock time in the reader's zone. */
export function clockTimestamp(ms: number): string {
  return `<t:${Math.floor(ms / 1000)}:t>`;
}

/** Discord renders `<t:seconds:f>` as a short date with the clock time, in the reader's zone and language. */
export function dateTimeStamp(ms: number): string {
  return `<t:${Math.floor(ms / 1000)}:f>`;
}
