import { defineCommand } from '../defineCommand.js';
import {
  loadLinkCodes,
  loadLinkedAccounts,
  saveLinkCodes,
  saveLinkedAccounts,
} from '../../utils/linkUtils.js';
import type { LinkCodesMap, LinkedAccountsMap } from '../../types/index.js';

let codes: LinkCodesMap = {};
let linked: LinkedAccountsMap = {};
let saving = false;
let pendingSave = false;

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
    console.error('Link save error:', err);
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

export const { init, COMMAND_INFO } = cmd;
