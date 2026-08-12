/**
 * Reading a server-list ping's version string.
 *
 * The ping answers with a free-text `version.name` that the server picks:
 * vanilla sends "1.21.4", Fabric sends "Fabric 1.21.4", Paper sends
 * "Paper 1.21.4", proxies send whatever they like, and a server with a
 * custom MOTD-style version sends marketing copy. There is no field that
 * says "the loader is Fabric" — it has to be read out of that string.
 *
 * So this is best-effort by construction, and says so: an unrecognised
 * string yields a null loader and the raw text, rather than a guess. `/info`
 * would rather print "1.21.4" with no loader than confidently name the wrong
 * one to someone about to install mods.
 *
 * Pure and framework-free, so it can be unit-tested without a socket.
 */

/** Loaders whose name conventionally prefixes the version in a ping. */
const KNOWN_LOADERS = [
  "Fabric",
  "Forge",
  "NeoForge",
  "Quilt",
  "Paper",
  "Purpur",
  "Spigot",
  "Bukkit",
  "Folia",
  "Velocity",
  "BungeeCord",
  "Waterfall",
] as const;

export interface VersionInfo {
  /** The Minecraft version, when one could be found: "1.21.4". */
  minecraftVersion: string | null;
  /** The loader or server software, when the string named one. */
  loader: string | null;
  /** Exactly what the server sent, always. */
  raw: string;
}

/** A dotted release number: 1.21, 1.21.4, 1.7.10. */
const MC_VERSION = /\b(1\.\d{1,2}(?:\.\d{1,2})?)\b/;

export function parseVersionName(raw: string | null): VersionInfo {
  if (!raw) return { minecraftVersion: null, loader: null, raw: "" };
  const text = raw.trim();
  const version = MC_VERSION.exec(text)?.[1] ?? null;
  // Match on a word boundary so "Paperclip" does not read as "Paper", and
  // check the longer names first so NeoForge is not truncated to Forge.
  const loader =
    [...KNOWN_LOADERS]
      .sort((a, b) => b.length - a.length)
      .find((name) => new RegExp(`\\b${name}\\b`, "i").test(text)) ?? null;
  return { minecraftVersion: version, loader, raw: text };
}
