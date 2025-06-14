import { sendToServer } from "./sendToServer.js";

/**
 * Adds a user to the Minecraft whitelist.
 *
 * @param {string} username
 * @returns {Promise<boolean>}
 */
export async function whitelistUser(username) {
  try {
    await sendToServer(`/whitelist add ${username}`);
    return true;
  } catch (err) {
    console.error("Whitelist error:", err.stderr || err.error);
    return false;
  }
}
