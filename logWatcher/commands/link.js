import { registerLogCommand } from "../logWatcher.js";
import {
  loadLinkCodes,
  loadLinkedAccounts,
  saveLinkCodes,
  saveLinkedAccounts,
} from "../../utils/linkUtils.js";

let codes = {};
let linked = {};
let codesDirty = false;
let linkedDirty = false;
let saving = false;
let pendingSave = false;

// Regex for: [time] [Server thread/INFO]: <User> !link CODE123
const LINK_CODE_REGEX = /\[.+?\]: <(?:\[AFK\]\s*)?([^>]+)> !link ([A-Za-z0-9]{6})/;

async function loadData() {
  codes = await loadLinkCodes().catch(() => ({}));
  linked = await loadLinkedAccounts().catch(() => ({}));
}

async function saveData() {
  if (saving) {
    pendingSave = true;
    return;
  }
  saving = true;

  try {
    if (codesDirty) {
      await saveLinkCodes(codes);
      codesDirty = false;
    }
    if (linkedDirty) {
      await saveLinkedAccounts(linked);
      linkedDirty = false;
    }
  } catch (err) {
    console.error("Error saving link data:", err);
  } finally {
    saving = false;
    if (pendingSave) {
      pendingSave = false;
      await saveData();
    }
  }
}

async function handleLinkCommand(match, client) {
  const [, username, code] = match;
  const entry = codes[code];
  if (!entry) return;

  const { discordId, expires } = entry;
  const user = client.users.cache.get(discordId);

  if (Date.now() > expires) {
    delete codes[code];
    codesDirty = true;
    await saveData();

    if (user)
      user
        .send(`❌ Link code **${code}** has expired. Please request a new one.`)
        .catch(console.error);

    return;
  }

  linked[discordId] = username;
  linkedDirty = true;
  delete codes[code];
  codesDirty = true;

  await saveData();

  if (user)
    user
      .send(`✅ Successfully linked to Minecraft user **${username}**.`)
      .catch(console.error);

  console.log(`Linked ${discordId} → ${username}`);
}

/**
 * Initialize the !link command listener.
 */
export async function init() {
  await loadData();
  registerLogCommand(LINK_CODE_REGEX, handleLinkCommand);
  console.log("🔗 !link command handler registered");
}
