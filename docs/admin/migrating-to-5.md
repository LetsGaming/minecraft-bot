# Migrating from 4.x to 5.0

**5.0.0 removes local mode.** The bot no longer talks to a Minecraft server by
reading its files, sending keystrokes to a `screen` session, or opening its own
RCON connection. Every server is reached over HTTP through the
[API wrapper](https://github.com/LetsGaming/minecraft-server-api) running on the
Minecraft host.

If you run the bot on the same machine as your server and have never installed
the wrapper, this release requires you to install it. That is the whole
migration; the rest of this page is detail.

**4.3.x is the last release that supports local deployment.** It stays where it
is and keeps working, but it is end-of-life: no fixes, no features, no security
updates. It will not be revisited.

## Why

The bot supported two ways of reaching a server, and every feature had to be
written twice — once against the filesystem and once against the wrapper. The
two halves drifted. Real bugs that shipped because of it:

- `/stats` on a player with no stats file worked locally and errored remotely.
  Same input, two answers.
- Daily rewards were verified locally and assumed successful remotely, so a
  failed `give` was reported to the player as a successful claim.
- `sendCommand` preferred RCON over the wrapper when both were configured, so
  the two paths could disagree about what a server had just been told.

The wrapper path was already the one under test and the one most people ran.
Keeping the other one meant every new feature paid for a code path that made
the bot less correct.

## What you need

The wrapper on each Minecraft host, and its URL and API key in the bot's config.
See [remote-setup.md](remote-setup.md) for installing it — that page was the
"bot and server on different machines" guide and is now simply the setup guide.

The wrapper needs **3.1.1 or newer**. Older versions work for most routes, but
3.1.1 fixes stats reads on non-vanilla world layouts (Fabric, Forge, and other
servers that store player stats under `world/players/stats/`), which affects
`/stats`, `/leaderboard`, and `/compare`.

## Config changes

The `servers` block is now `apiUrl` + `apiKey` per server, and nothing else:

```jsonc
// 4.x
{
  "servers": {
    "survival": {
      "serverDir": "/srv/minecraft/survival",
      "scriptDir": "/srv/minecraft/scripts/survival",
      "linuxUser": "minecraft",
      "screenSession": "survival",
      "useRcon": true,
      "rconHost": "127.0.0.1",
      "rconPort": 25575,
      "rconPassword": "hunter2"
    }
  }
}

// 5.0
{
  "servers": {
    "survival": {
      "apiUrl": "http://192.168.1.10:3030",
      "apiKey": "sk_live_..."
    }
  }
}
```

The removed fields — `serverDir`, `scriptDir`, `linuxUser`, `screenSession`,
`useRcon`, `rconHost`, `rconPort`, `rconPassword` — describe the Minecraft host,
so they move to the **wrapper's** config on that host. They are not renamed and
they do not have equivalents here.

The bot refuses to start with any of them still present, and names them:

```
Config validation failed:
  - servers.survival: serverDir, linuxUser, useRcon configured local mode,
    which was removed in 5.0.0. ...
```

That is deliberate. Ignoring them silently would leave you with a config that
looks like it configures RCON and a bot that does not use it.

### The single-server format is gone

The pre-`servers` format, where the top-level object doubled as one server
block, only ever carried local fields. Wrap it in a `servers` map:

```jsonc
// before
{ "token": "...", "clientId": "...", "serverDir": "/srv/mc", "linuxUser": "mc" }

// after
{
  "token": "...",
  "clientId": "...",
  "servers": { "default": { "apiUrl": "http://...", "apiKey": "..." } }
}
```

### API keys from the environment

`apiKey` can come from the environment instead of `config.json`:

| Variable | Applies to |
|---|---|
| `API_KEY_<SERVER_ID>` | that server (e.g. `API_KEY_SURVIVAL`) |
| `API_KEY` | every server without a more specific key |

This replaces `RCON_PASSWORD_<ID>`, which configured the bot's own RCON
connection. The wrapper still reads `RCON_PASSWORD_<ID>` for *its* connection —
same variable name, different machine, different process.

## Deployment

**Docker is the supported way to run the bot**, and the dashboard ships with it.
See [docker.md](docker.md).

It is a Node application and nothing stops you from running it directly, but
that is not a supported configuration and there is no guide for it.

If you were running the bot under PM2 on the Minecraft host so that it could
reach the server's files, that reason is gone: it can run anywhere that can
reach the wrapper over HTTP.

## What is not affected

- **Your data.** `bot.db` carries over untouched — links, snapshots,
  leaderboards, daily streaks, pending rewards.
- **Guild config, commands, features.** Unchanged.
- **The dashboard.** Still edits the bot's config, in the bot's container.
- **Every slash command.** The commands that used to run locally now run
  through the wrapper. `/server`, `/backup`, and `/mods` still depend on the
  [setup suite](https://github.com/LetsGaming/minecraft-server-setup) layout —
  the wrapper is what looks for it now.

## Checklist

1. Install the wrapper (3.1.1+) on each Minecraft host — [remote-setup.md](remote-setup.md).
2. Move `useRcon` / `rcon*` / `linuxUser` / `serverDir` / `scriptDir` /
   `screenSession` from the bot's config into the wrapper's.
3. Replace each server block in `config.json` with `apiUrl` + `apiKey`.
4. Start the bot. If anything is left over, it says so by name and refuses to
   start — that message is the rest of this checklist.
