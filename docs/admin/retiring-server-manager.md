# Retiring minecraft-server-manager

The standalone server-manager panel is superseded. Everything it did is now in
the dashboard, reached through the API wrapper like every other server
operation.

This page is the operator's side: what moved where, what to do on each host,
and the one thing you lose.

## Why

The panel was not a second dashboard so much as a second *wrapper*. It ran on
the Minecraft host, shelled out to the same setup-suite scripts, and carried
its own RCON client, its own `variables.txt` parser and its own instance
registry. Two privileged local agents on the same host, for one capability.

It was also half-migrated: three of its six route modules were never mounted,
and one of its tests exercised a copy of code that no longer ran.

## Where everything went

| Server manager | Dashboard |
|---|---|
| Login (local username/password) | Discord OAuth2, or the runbook below |
| Instance list, status | Servers |
| Start, shutdown, restart | Servers → the action buttons |
| Smart restart | The same **Restart** button — it always ran `smart_restart.sh` |
| Rollback | Servers → **Rollback** (type-the-name confirm) |
| Console command | Console |
| Live terminal | Console |
| Log tail | Console, or Servers → View log |
| List backups | Backups |
| Download backup | Backups → Download |
| Create backup | Servers → **Backup** |
| Restore backup | Backups → Restore (type-the-name confirm) |
| Blocked commands | `webui.console.blockedCommands` |
| Public status page | Not carried over — see below |

Two things are deliberately absent:

**Plain `restart.sh`.** The panel exposed both it and `smart_restart.sh`. The
dashboard only offers the smart one, which warns players first. A second button
meaning "restart, but without telling anyone" has no use worth the confusion.

**The terminal's screen fallback.** The wrapper already picks RCON or `screen`
behind a single endpoint. The dashboard does not know or care which it used.

## Before you start

You need **wrapper 3.3.0 or newer on every host**, for the backup index,
download, restore and rollback. Older wrappers still work; the dashboard hides
the Backups tab and the Rollback button on a host that cannot serve them, so a
staggered rollout is safe and shows nothing broken in the meantime.

Check what a host is running:

```bash
curl -s -H "x-api-key: $MC_API_KEY" http://127.0.0.1:3000/manifest | jq '.wrapper, .features | keys'
```

You want `backup-files` and `backup-restore` in that feature list.

## Configure the dashboard

**Console deny-list.** The panel's `BLOCKED_COMMANDS` moves to `config.json`:

```jsonc
"webui": {
  "console": { "blockedCommands": ["stop", "op", "deop"] }
}
```

Omit the key to get exactly those three defaults. An explicit empty array means
"block nothing", which is a choice you can make but should make on purpose.

Matching is on the first word, after any leading slashes, case-insensitively —
so one entry covers `stop`, `/stop` and `STOP`. It matches the whole word, so
blocking `stop` does not also block a plugin's `/stopwatch`.

**Accounts.** The panel had its own `users.json`. Everyone who used it needs a
Discord account, and either an entry in `adminUsers` or a grant under
`webui.grants`. See [capabilities.md](capabilities.md) — most people who had a
panel login do not need full sysadmin.

## What you lose: the local login

The panel had a username and password that worked with no Discord involved. The
dashboard is Discord OAuth2 only, so if Discord's API is unreachable, there is
no browser route into the dashboard.

This is a real regression and worth a moment's thought rather than a shrug. In
practice you still have two paths that do not involve Discord: SSH to the host,
and the wrapper's HTTP API with its key. The runbook below covers the second.

If you would rather keep a browser fallback, that is a feature to add to the
dashboard's auth layer, not a reason to keep a second privileged service
running on the game host.

## Emergency access without the dashboard

See [emergency-access.md](emergency-access.md). Read it once now, while nothing
is broken. Finding out what your API key is called is not a task for an outage.

## The public status page — not carried over

The panel could serve status and IP-redacted logs before login
(`PUBLIC_LOGS`). **This is deliberately not replaced.** The dashboard has no
public surface: every route requires a session.

Nothing needs removing on the dashboard side, because it never had one. The
IP-redaction code goes with the panel, which is the right place for it — it
existed only because those logs were public in the first place.

If you later want players to see server status without logging in, that is
dashboard phase 4 on the roadmap, and it should be designed as a public page
rather than reconstructed from what the panel happened to expose.

## Decommissioning a host

Once the dashboard covers what you use, on each host:

```bash
# 1. Stop it and keep it stopped.
sudo systemctl stop minecraft-server-manager
sudo systemctl disable minecraft-server-manager

# 2. Confirm nothing still answers.
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8080/ || echo "down"

# 3. Close the port at the reverse proxy, then reload it.
#    (NPMplus: delete the proxy host entry.)

# 4. Remove the credentials. These are the reason not to leave it lying around
#    "just in case": a stopped service with a valid users.json and JWT_SECRET
#    on disk is a login waiting to be re-enabled by someone who is not you.
sudo shred -u /opt/minecraft-server-manager/users.json
sudo shred -u /opt/minecraft-server-manager/.env

# 5. Remove the unit and the checkout.
sudo rm /etc/systemd/system/minecraft-server-manager.service
sudo systemctl daemon-reload
sudo rm -rf /opt/minecraft-server-manager
```

Do not leave both running side by side longer than the rollout takes. Two
privileged local agents on the Minecraft host is twice the attack surface for
one capability, which is the argument the whole migration rests on.

## Checklist

- [ ] Wrapper 3.3.0+ on every host, `backup-files` in the manifest
- [ ] Console reachable, and a test command runs
- [ ] Backups list, and a download completes
- [ ] Rollback button visible on a host that has `rollback.sh`
- [ ] `webui.console.blockedCommands` set, or the defaults accepted
- [ ] Everyone who had a panel login has Discord access with the right grants
- [ ] Emergency runbook read, and the API key location noted somewhere you can
      reach without the dashboard
- [x] Public status page — decided: not carried over
- [ ] Service stopped, disabled, port closed, credentials shredded, checkout removed
