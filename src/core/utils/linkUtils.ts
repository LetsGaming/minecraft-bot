/**
 * Discord <-> Minecraft account links, backed by SQLite
 * (linked_accounts + link_codes tables).
 *
 * Two API layers:
 *
 *   Legacy map API (loadLinkedAccounts/saveLinkedAccounts/…) — kept so the
 *   many readers (profile, whois, deaths, defineCommand, streak
 *   leaderboard, …) stay untouched. save* replaces the whole table in one
 *   transaction, matching the old file semantics.
 *
 *   Atomic operations (issueLinkCode/confirmLinkCode/unlinkAccount) — what
 *   the three writers now use. Each wraps its whole read-modify-write in
 *   one IMMEDIATE transaction, closing the lost-update race the old
 *   load/mutate/save pattern had (two concurrent /link completions could
 *   clobber each other; documented as F3 in the 4.0 rework).
 */
import { getDb, withTransaction } from "../db/index.js";
import { mapRows, col } from "../db/rows.js";
import type { LinkCodesMap, LinkedAccountsMap } from "../types/index.js";

export const LINK_CODE_TTL_MS = 5 * 60 * 1000;

// ── Legacy map API (readers + whole-map writers) ──────────────────────────

export async function loadLinkedAccounts(): Promise<LinkedAccountsMap> {
  const rows = mapRows(
    getDb().prepare("SELECT discord_id, mc_name FROM linked_accounts"),
    (r) => ({
      discord_id: col.text(r, "discord_id"),
      mc_name: col.text(r, "mc_name"),
    }),
  );
  const map: LinkedAccountsMap = {};
  for (const r of rows) map[r.discord_id] = r.mc_name;
  return map;
}

export async function saveLinkedAccounts(
  map: LinkedAccountsMap,
): Promise<void> {
  withTransaction(() => {
    const db = getDb();
    db.exec("DELETE FROM linked_accounts");
    const ins = db.prepare(
      "INSERT INTO linked_accounts (discord_id, mc_name) VALUES (?, ?)",
    );
    for (const [discordId, mcName] of Object.entries(map)) {
      ins.run(discordId, mcName);
    }
  });
}

export async function loadLinkCodes(): Promise<LinkCodesMap> {
  const rows = mapRows(
    getDb().prepare(
      "SELECT code, discord_id, expires, confirmed FROM link_codes",
    ),
    (r) => ({
      code: col.text(r, "code"),
      discord_id: col.text(r, "discord_id"),
      expires: col.int(r, "expires"),
      confirmed: col.int(r, "confirmed"),
    }),
  );
  const map: LinkCodesMap = {};
  for (const r of rows) {
    map[r.code] = {
      discordId: r.discord_id,
      expires: r.expires,
      confirmed: r.confirmed === 1,
    };
  }
  return map;
}

export async function saveLinkCodes(codes: LinkCodesMap): Promise<void> {
  withTransaction(() => {
    const db = getDb();
    db.exec("DELETE FROM link_codes");
    const ins = db.prepare(
      "INSERT INTO link_codes (code, discord_id, expires, confirmed) VALUES (?, ?, ?, ?)",
    );
    for (const [code, entry] of Object.entries(codes)) {
      ins.run(code, entry.discordId, entry.expires, entry.confirmed ? 1 : 0);
    }
  });
}

export async function isLinked(userId: string): Promise<boolean> {
  const linked = await getLinkedAccount(userId);
  return linked !== null;
}

export async function getLinkedAccount(userId: string): Promise<string | null> {
  const row = getDb()
    .prepare("SELECT mc_name FROM linked_accounts WHERE discord_id = ?")
    .get(userId) as { mc_name: string } | undefined;
  return row?.mc_name ?? null;
}

// ── Atomic link operations ────────────────────────────────────────────────

export type IssueLinkCodeResult =
  | { status: "issued"; code: string; expires: number }
  | { status: "pending"; code: string }
  | { status: "already-linked" };

/**
 * /link: issue a fresh code for this Discord user — unless they are
 * already linked (linked_accounts is the source of truth — the old JSON
 * flow inferred this from leftover confirmed codes, which unlink never
 * cleaned, so an unlinked user could never relink) or a still-valid code
 * is already pending (return it). Expired codes for this user are pruned
 * in the same transaction.
 */
export async function issueLinkCode(
  discordId: string,
  code: string,
  ttlMs: number = LINK_CODE_TTL_MS,
): Promise<IssueLinkCodeResult> {
  return withTransaction(() => {
    const db = getDb();
    const now = Date.now();

    const linkedRow = db
      .prepare("SELECT 1 FROM linked_accounts WHERE discord_id = ?")
      .get(discordId);
    if (linkedRow) return { status: "already-linked" } as const;

    const rows = mapRows(
      db.prepare(
        "SELECT code, expires, confirmed FROM link_codes WHERE discord_id = ?",
      ),
      (r) => ({
        code: col.text(r, "code"),
        expires: col.int(r, "expires"),
        confirmed: col.int(r, "confirmed"),
      }),
      discordId,
    );

    for (const row of rows) {
      if (row.expires > now && row.confirmed === 0) {
        return { status: "pending", code: row.code } as const;
      }
      // Expired (any) or confirmed leftovers: prune.
      db.prepare("DELETE FROM link_codes WHERE code = ?").run(row.code);
    }

    const expires = now + ttlMs;
    db.prepare(
      "INSERT INTO link_codes (code, discord_id, expires, confirmed) VALUES (?, ?, ?, 0)",
    ).run(code, discordId, expires);
    return { status: "issued", code, expires } as const;
  });
}

export type ConfirmLinkResult =
  | { status: "linked"; discordId: string }
  | { status: "unknown-code" }
  | { status: "expired"; discordId: string }
  | { status: "name-taken"; discordId: string };

/**
 * In-game `!link CODE`: validate the code, enforce the one-Minecraft-
 * account-one-Discord-account rule (case-insensitive — daily-reward
 * cooldowns are per Discord user, so a second link would double /daily
 * claims), write the link, and mark the code confirmed — all in one
 * transaction, so two players confirming simultaneously cannot interleave.
 */
export async function confirmLinkCode(
  code: string,
  username: string,
): Promise<ConfirmLinkResult> {
  return withTransaction(() => {
    const db = getDb();
    const entry = db
      .prepare(
        "SELECT discord_id, expires, confirmed FROM link_codes WHERE code = ?",
      )
      .get(code) as
      | { discord_id: string; expires: number; confirmed: number }
      | undefined;

    if (!entry) return { status: "unknown-code" } as const;

    if (Date.now() > entry.expires) {
      db.prepare("DELETE FROM link_codes WHERE code = ?").run(code);
      return { status: "expired", discordId: entry.discord_id } as const;
    }

    const owner = db
      .prepare(
        `SELECT discord_id FROM linked_accounts
         WHERE mc_name = ? COLLATE NOCASE AND discord_id != ?`,
      )
      .get(username, entry.discord_id) as { discord_id: string } | undefined;
    if (owner) {
      return { status: "name-taken", discordId: entry.discord_id } as const;
    }

    db.prepare(
      `INSERT INTO linked_accounts (discord_id, mc_name) VALUES (?, ?)
       ON CONFLICT(discord_id) DO UPDATE SET mc_name = excluded.mc_name`,
    ).run(entry.discord_id, username);
    db.prepare("UPDATE link_codes SET confirmed = 1 WHERE code = ?").run(code);

    return { status: "linked", discordId: entry.discord_id } as const;
  });
}

/** /unlink: remove the link. Returns false when none existed. */
export async function unlinkAccount(discordId: string): Promise<boolean> {
  return withTransaction(() => {
    const db = getDb();
    const existed = db
      .prepare("SELECT 1 FROM linked_accounts WHERE discord_id = ?")
      .get(discordId);
    if (!existed) return false;
    db.prepare("DELETE FROM linked_accounts WHERE discord_id = ?").run(
      discordId,
    );
    return true;
  });
}
