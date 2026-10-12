/** Discord renders `<t:seconds:R>` in each reader's own locale and clock. */
export function formatLastSeen(ms: number): string {
  return `<t:${Math.floor(ms / 1000)}:R>`;
}

/** Same as formatLastSeen: "in 15 hours", "35 minutes ago", per reader. */
export const relativeTimestamp = formatLastSeen;

/** Discord renders `<t:seconds:t>` as a short clock time in the reader's zone. */
export function clockTimestamp(ms: number): string {
  return `<t:${Math.floor(ms / 1000)}:t>`;
}
