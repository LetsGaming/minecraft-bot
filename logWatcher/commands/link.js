import { defineCommand } from "../defineCommand.js";
import {
  loadLinkCodes, loadLinkedAccounts,
  saveLinkCodes, saveLinkedAccounts,
} from "../../utils/linkUtils.js";

let codes = {};
let linked = {};
let saving = false;
let pendingSave = false;

async function loadData() {
  codes = await loadLinkCodes().catch(() => ({}));
  linked = await loadLinkedAccounts().catch(() => ({}));
}

async function saveData() {
  if (saving) { pendingSave = true; return; }
  saving = true;
  try {
    await saveLinkCodes(codes);
    await saveLinkedAccounts(linked);
  } catch (err) {
    console.error("Error saving link data:", err);
  } finally {
    saving = false;
    if (pendingSave) { pendingSave = false; await saveData(); }
  }
}

const cmd = defineCommand({
  name: "link",
  description: "Link your Minecraft account to Discord using a code",
  args: ["code"],
  handler: async (username, { code }, client) => {
    const entry = codes[code];
    if (!entry) return;

    const { discordId, expires } = entry;
    const user = client.users.cache.get(discordId);

    if (Date.now() > expires) {
      delete codes[code];
      await saveData();
      if (user) user.send(`❌ Link code **${code}** has expired.`).catch(console.error);
      return;
    }

    linked[discordId] = username;
    delete codes[code];
    await saveData();

    if (user) user.send(`✅ Linked to Minecraft user **${username}**.`).catch(console.error);
    console.log(`Linked ${discordId} → ${username}`);
  },
});

// Override init to load data first
const originalInit = cmd.init;
cmd.init = async () => {
  await loadData();
  originalInit();
};

export const { init, COMMAND_INFO } = cmd;
