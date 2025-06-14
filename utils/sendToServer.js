import config from "../config.json" assert { type: "json" };
import { execCommand } from "../shell/execCommand.js";

/**
 * Sends a command to the Minecraft server screen session.
 *
 * @param {string} command - The command to send (without newline)
 * @returns {Promise<void>}
 */
export async function sendToServer(command) {
  const fullCommand = `sudo -u ${config.linuxUser} screen -S ${config.screenSession} -X stuff "${command}$(printf '\\r')"`;
  await execCommand(fullCommand);
}
