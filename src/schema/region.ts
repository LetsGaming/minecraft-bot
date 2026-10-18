/** A Minecraft region file covers REGION_CHUNKS x REGION_CHUNKS chunks. */
export const REGION_CHUNKS = 32;

/** Chunk coordinate >> REGION_SHIFT is the region coordinate. */
export const REGION_SHIFT = 5;

/** Chunk coordinate & REGION_MASK is the chunk's index inside its region. */
export const REGION_MASK = REGION_CHUNKS - 1;
