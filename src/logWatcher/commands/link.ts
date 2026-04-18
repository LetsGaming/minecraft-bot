import { defineCommand } from '../defineCommand.js';
import {
  loadLinkCodes,
  loadLinkedAccounts,
  saveLinkCodes,
  saveLinkedAccounts,
} from '../../utils/linkUtils.js';
import type { LinkCodesMap, LinkedAccountsMap } from '../../types/index.js';
import { log } from '../../utils/logger.js';

let codes: LinkCodesMap = {};
let linked: LinkedAccountsMap = {};
let saving = false;
let pendingSave = false;

// Rate-limit per-player !link attempts to prevent brute-forcing codes.
// Tracks the timestamp of the last attempt per Minecraft username.
const linkAttempts = new Map<string, number>();
const LINK_ATTEMPT_COOLDOWN_MS = 3_000;

async function loadData(): Promise<void> {
  codes = await loadLinkCodes().catch(() => ({} as LinkCodesMap));
  linked = await loadLinkedAccounts().catch(() => ({} as LinkedAccountsMap));
}

async function saveData(): Promise<void> {
  if (saving) {
    pendingSave = true;
    return;
  }
  saving = true;
  try {
    await saveLinkCodes(codes);
    await saveLinkedAccounts(linked);
  } catch (err) {
    log.error('link', `Link save error: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    saving = false;
    if (pendingSave) {
      pendingSave = false;
      await saveData();
    }
  }
}

const cmd = defineCommand({
  name: 'link',
  description: 'Link your Minecraft account to Discord using a code',
  args: ['code'],
  handler: async (username, { code }, client) => {
    if (!code) return;

    // Rate-limit: reject if the same player tried within the cooldown window
    const lastAttempt = linkAttempts.get(username) ?? 0;
    if (Date.now() - lastAttempt < LINK_ATTEMPT_COOLDOWN_MS) return;
    linkAttempts.set(username, Date.now());

    const entry = codes[code];
    if (!entry) return;
    const { discordId, expires } = entry;
    const user = client.users.cache.get(discordId);
    if (Date.now() > expires) {
      delete codes[code];
      await saveData();
      if (user)
        user.send(`❌ Link code **${code}** has expired.`).catch(() => {});
      return;
    }
    linked[discordId] = username;
    delete codes[code];
    await saveData();
    if (user)
      user.send(`✅ Linked to Minecraft user **${username}**.`).catch(() => {});
  },
});

const originalInit = cmd.init;
cmd.init = async (): Promise<void> => {
  await loadData();
  originalInit();
};

export const { init, COMMAND_INFO, handler } = cmd;

/**
 * Reset all in-memory state. Only for use in tests.
 */
export function _resetStateForTesting(): void {
  codes = {};
  linked = {};
  saving = false;
  pendingSave = false;
  linkAttempts.clear();
}
