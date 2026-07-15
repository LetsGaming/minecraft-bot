/**
 * Chunkbase seed-map URL builder.
 *
 * The same URL was previously assembled inline in both chunkbase commands
 * (slash + in-game); the death-coordinate DM makes a third caller, so the
 * logic moves here — one implementation, like sanitize.ts did for console
 * input.
 */

/** Normalize a Minecraft dimension id ("minecraft:the_nether", "nether", …)
 *  to the value Chunkbase expects (overworld | nether | end). */
export function chunkbaseDimension(dimension: string): string {
  const d = dimension.replace(/^minecraft:/, "").toLowerCase();
  if (d.includes("nether")) return "nether";
  if (d.includes("end")) return "end";
  return "overworld";
}

export function buildChunkbaseUrl(
  seed: string,
  dimension = "overworld",
  x?: number,
  z?: number,
): string {
  const coordsParam =
    x !== undefined && z !== undefined
      ? `&x=${Math.floor(x)}&z=${Math.floor(z)}`
      : "";
  return `https://www.chunkbase.com/apps/seed-map#seed=${seed}&dimension=${chunkbaseDimension(dimension)}${coordsParam}`;
}
