import { HttpError } from "./errors.js";

export interface IconImage {
  contentType: string;
  body: Buffer;
}

export const ICON_MAX_BYTES = 1024 * 1024;
export const ICON_MAX_ENTRIES = 200;
const ICON_TTL_MS = 24 * 60 * 60 * 1000;
const ICON_FETCH_TIMEOUT_MS = 8_000;

/** Raster formats only: SVG served from our own origin can carry script. */
const ALLOWED_CONTENT_TYPE = /^image\/(png|jpe?g|gif|webp|avif)$/i;

const cache = new Map<string, { expires: number; image: IconImage }>();

export function clearIconCache(): void {
  cache.clear();
}

async function readCapped(res: Response): Promise<Buffer> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > ICON_MAX_BYTES) {
    throw new HttpError(502, "Icon too large.");
  }
  if (!res.body) throw new HttpError(502, "Icon fetch failed.");
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > ICON_MAX_BYTES) {
      await reader.cancel();
      throw new HttpError(502, "Icon too large.");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/**
 * Fetch an icon from an already validated URL. The response is size-capped,
 * limited to raster image types, and kept in a bounded in-memory cache
 * (oldest entry evicted first).
 */
export async function fetchIcon(href: string, userAgent: string): Promise<IconImage> {
  const hit = cache.get(href);
  if (hit && hit.expires > Date.now()) return hit.image;
  cache.delete(href);

  const res = await fetch(href, {
    headers: { "User-Agent": userAgent },
    signal: AbortSignal.timeout(ICON_FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new HttpError(502, "Icon fetch failed.");
  const contentType = (res.headers.get("content-type") ?? "").split(";")[0]!.trim();
  if (!ALLOWED_CONTENT_TYPE.test(contentType)) {
    throw new HttpError(502, "Icon fetch failed.");
  }
  const image: IconImage = { contentType, body: await readCapped(res) };

  cache.set(href, { expires: Date.now() + ICON_TTL_MS, image });
  while (cache.size > ICON_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  return image;
}
