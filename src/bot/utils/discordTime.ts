/** Discord renders `<t:seconds:R>` in each reader's own locale and clock. */
export function formatLastSeen(ms: number): string {
  return `<t:${Math.floor(ms / 1000)}:R>`;
}
