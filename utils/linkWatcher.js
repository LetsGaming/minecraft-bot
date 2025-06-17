import fs from 'fs';
import path from 'path';
import readline from 'readline';
import config from '../../config.json' assert { type: 'json' };

const codesPath = './data/linkCodes.json';
const linkedPath = './data/linkedAccounts.json';
const logFile = path.join(config.serverDir, 'logs', 'latest.log');

// Call this on startup
export function watchForLinkCodes(client) {
  let lastSize = 0;

  setInterval(() => {
    const stats = fs.statSync(logFile);
    if (stats.size < lastSize) lastSize = 0; // log rollover
    if (stats.size === lastSize) return;

    const stream = fs.createReadStream(logFile, {
      start: lastSize,
      end: stats.size
    });

    const rl = readline.createInterface({ input: stream });
    rl.on('line', (line) => handleLogLine(line, client));

    lastSize = stats.size;
  }, 3000);
}

function handleLogLine(line, client) {
  const match = line.match(/\[.+?\]: (.+?): !link ([A-Z0-9]{6})/);
  if (!match) return;

  const [_, username, code] = match;
  const codes = loadJson(codesPath);

  if (!(code in codes)) return;
  if (Date.now() > codes[code].expires) {
    delete codes[code];
    saveJson(codesPath, codes);
    return;
  }

  const { discordId } = codes[code];
  const linked = loadJson(linkedPath);
  linked[discordId] = username;
  saveJson(linkedPath, linked);

  delete codes[code];
  saveJson(codesPath, codes);

  const user = client.users.cache.get(discordId);
  if (user) {
    user.send(`✅ Successfully linked to Minecraft user **${username}**.`);
  }

  console.log(`Linked ${discordId} ⇄ ${username}`);
}


