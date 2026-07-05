/**
 * Slime-chunk determination for Java Edition.
 *
 * Vanilla decides slime chunks deterministically from the world seed:
 *
 *   Random rnd = new Random(
 *       seed
 *       + (long) (xPos * xPos * 0x4c1906)
 *       + (long) (xPos * 0x5ac0db)
 *       + (long) (zPos * zPos) * 0x4307a7L
 *       + (long) (zPos * 0x5f24f)
 *       ^ 0x3ad8025fL);
 *   isSlimeChunk = rnd.nextInt(10) == 0;
 *
 * The subtlety is that `xPos * xPos * 0x4c1906`, `xPos * 0x5ac0db`,
 * `zPos * zPos` and `zPos * 0x5f24f` are 32-bit int multiplications in
 * Java — they wrap — and only then widen to long. This module reproduces
 * that exactly with BigInt + BigInt.asIntN, plus a faithful
 * java.util.Random (48-bit LCG per the Java SE spec: seed' =
 * (seed * 0x5DEECE66D + 0xB) mod 2^48).
 */

const LCG_MULT = 0x5deece66dn;
const LCG_ADD = 0xbn;
const MASK_48 = (1n << 48n) - 1n;

/** Java `int` multiplication: 32-bit two's-complement wrap. */
function imulJava(a: bigint, b: bigint): bigint {
  return BigInt.asIntN(32, BigInt.asIntN(32, a) * BigInt.asIntN(32, b));
}

/**
 * java.util.Random#nextInt(bound) for the one call vanilla makes.
 * Implements the spec's rejection loop so the distribution matches Java
 * bit-for-bit (bound 10 is not a power of two).
 */
function javaNextIntBounded(scrambledSeed: bigint, bound: number): number {
  const b = BigInt(bound);
  let seed = scrambledSeed;

  const next31 = (): bigint => {
    seed = (seed * LCG_MULT + LCG_ADD) & MASK_48;
    return seed >> 17n; // next(31): top 31 of the 48-bit state
  };

  // Spec rejection loop: retry while bits - val + (bound-1) overflows int.
  for (;;) {
    const bits = next31();
    const val = bits % b;
    if (BigInt.asIntN(32, bits - val + (b - 1n)) >= 0n) return Number(val);
  }
}

/**
 * Is the chunk at (chunkX, chunkZ) a slime chunk for this world seed?
 * Coordinates are CHUNK coordinates (block >> 4), seed is the numeric
 * world seed as a string (as returned by ServerInstance.getSeed()).
 */
export function isSlimeChunk(
  seed: string | bigint,
  chunkX: number,
  chunkZ: number,
): boolean {
  const worldSeed = BigInt.asIntN(64, BigInt(seed));
  const x = BigInt(Math.trunc(chunkX));
  const z = BigInt(Math.trunc(chunkZ));

  const term1 = imulJava(imulJava(x, x), 0x4c1906n); // (int)(x*x*0x4c1906)
  const term2 = imulJava(x, 0x5ac0dbn); //              (int)(x*0x5ac0db)
  const term3 = BigInt.asIntN(64, imulJava(z, z) * 0x4307a7n); // (long)(z*z)*L
  const term4 = imulJava(z, 0x5f24fn); //               (int)(z*0x5f24f)

  const rndSeed = BigInt.asIntN(
    64,
    BigInt.asIntN(64, worldSeed + term1 + term2 + term3 + term4) ^ 0x3ad8025fn,
  );

  // new Random(seed) scrambles: (seed ^ 0x5DEECE66D) & ((1<<48)-1)
  const scrambled = (rndSeed ^ LCG_MULT) & MASK_48;
  return javaNextIntBounded(scrambled, 10) === 0;
}

/** Block coordinate → chunk coordinate (floor division by 16). */
export function blockToChunk(coord: number): number {
  return Math.floor(coord / 16);
}
