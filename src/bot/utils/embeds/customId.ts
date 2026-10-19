/**
 * Stable component ids are colon-joined (`prefix:answer:action:serverId:...`)
 * and parsed by splitting, so a part containing ":" would shift every field
 * after it. Discord also rejects ids over 100 characters, which would fail
 * the whole reply at send time.
 */
export const CUSTOM_ID_MAX_LENGTH = 100;

export function joinCustomId(...parts: readonly string[]): string {
  const bad = parts.find((part) => part.includes(":"));
  if (bad !== undefined) {
    throw new Error(`Component id part "${bad}" contains ":"`);
  }
  const id = parts.join(":");
  if (id.length > CUSTOM_ID_MAX_LENGTH) {
    throw new Error(
      `Component id exceeds ${CUSTOM_ID_MAX_LENGTH} characters (${id.length})`,
    );
  }
  return id;
}
