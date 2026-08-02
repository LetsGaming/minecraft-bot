# Dashboard access: capabilities and grants

Two kinds of people use the dashboard, and they are separated by threat model
rather than by rank.

**Guild managers** administer a Discord server. Anyone with Manage Guild on a
guild the bot is in can log in and edit that guild's config block. They see
nothing about the Minecraft host, ever. Nothing in this page applies to them.

**Host users** reach the Minecraft server. That is everyone in the top-level
`adminUsers` list, plus anyone you grant a capability to in `webui.grants`.

## Why grants exist

`adminUsers` is all-or-nothing. Adding someone to it hands them the console,
the ability to restore a backup over the live world, and `config.json` —
which contains the Discord token and every RCON password.

That is the right grant for you. It is the wrong grant for the person who just
needs to turn down a mob spawn rate.

## The capabilities

Grouped by how much damage each one can do, which is also the order the config
editor lists them in.

| Capability | Grants |
|---|---|
| `server:read` | status, host metrics, the log tail, the console feed, the backup list |
| `audit:read` | the admin audit log |
| `server:control` | start, stop, restart, back up |
| `backup:create` | reserved for future separation from `server:control` |
| `config:read` | viewing mod config files |
| `server:console` | **sending** console commands |
| `backup:download` | downloading an archive |
| `config:write` | editing mod config files |
| `backup:restore` | restoring the world from an archive |
| `server:rollback` | rolling the world back |

Two are easy to get wrong:

**`server:console` is not `server:control`.** Restarting a server is disruptive
and recoverable. A console command can op an account, ban a player, or run a
worldedit operation that nobody notices for a week. Grant `server:control`
freely; think about `server:console`.

**`backup:download` takes the entire world off the host.** It is the one backup
operation that leaves no trace on the server itself, which is why it is
audited separately.

There is no `bot:config` to grant. Reading or writing `config.json` is
sysadmin-only by definition, and that is deliberate: since grants live in
`config.json`, only a sysadmin can change who has what — including themselves.

## Writing a grant

Under `webui` in `config.json`. The key is a Discord user ID, then a server id
or `"*"` for every server, then the capabilities.

```jsonc
"webui": {
  "grants": {
    // A trusted operator on every server, but no console and no restore.
    "234567890123456789": {
      "*": ["server:read", "server:control", "backup:create", "audit:read"]
    },
    // Someone who tunes mod settings on the survival server. Nothing else.
    "345678901234567890": {
      "survival": ["config:read", "config:write"]
    },
    // Read-only on one server, plus the ability to pull an archive.
    "456789012345678901": {
      "creative": ["server:read", "backup:download"]
    }
  }
}
```

Anyone in `adminUsers` already holds every capability on every server and needs
no entry here.

You can edit this in the dashboard's Config view, which renders it as a form
from the schema, so you get the capability list as a picker rather than having
to spell the strings correctly.

## Rules that are easy to trip over

**A per-server grant does not satisfy a fleet-wide route.** The audit log spans
every server, so reading it needs the capability under `"*"`. Someone granted
`audit:read` on `survival` alone gets a 403, on purpose: a grant on one server
must not disclose what happened on another.

**Grants take effect immediately.** They are re-read on every request, so
revoking someone applies on their next click. No restart, no waiting.

**A typo is silently dropped, not an error.** `"server:reed"` is not a
capability, so it grants nothing. If someone reports missing access, check the
spelling against the table above — or use the config editor's picker.

**Users see only what they hold.** The sidebar, the buttons, and the server
lists all render from the caller's capabilities, so someone with
`config:read`/`config:write` on one server sees the config editor for that
server and nothing else. They do not get a page of controls that fail on click.

## What this does not protect

Dashboard access control governs **dashboard users**. It is not a defence
against someone with SSH on the Minecraft host, or with the wrapper's API key.
Anyone holding either of those bypasses all of it.

Treat a grant as "I trust this person with this much of my server", not as a
sandbox.
