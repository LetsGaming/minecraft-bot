import { exec } from "child_process";
const config = require("../config.json");

export function whitelistUser(username) {
  return new Promise((resolve) => {
    const cmd = `sudo -u ${config.linuxUser} screen -S ${config.screenSession} -X stuff "/whitelist add ${username}$(printf '\\r')"`;

    exec(cmd, (error, stdout, stderr) => {
      if (error) {
        console.error(stderr);
        resolve(false);
      } else {
        resolve(true);
      }
    });
  });
}
