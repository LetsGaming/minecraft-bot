# Emergency access

For when the dashboard will not let you in: Discord's API is down, the OAuth
app is misconfigured, the web process is dead, or you are locked out for a
reason you have not diagnosed yet.

**Read this once now, while nothing is broken.** The step that takes longest
during an outage is remembering where the API key lives.

## Fill this in

Keep it somewhere reachable without the dashboard — a password manager, a
printed card, a note on your phone.

| | |
|---|---|
| Wrapper host and port | `___________________` (default `127.0.0.1:3000`) |
| API key location | `___________________` (e.g. `/opt/mc-api-server/.env`, `MC_API_KEY`) |
| SSH target | `___________________` |
| Instance ids | `___________________` |

## Why this exists rather than a second login page

The retired server-manager panel had a local username and password that worked
with no Discord involved. Losing it is the one real regression in retiring that
panel.

The reason it was not rebuilt in the dashboard is that the fallback it provided
already exists in a better form. A browser login is a whole new authentication
surface to maintain, on the same host, for the rare case where you already have
SSH and an API key. What follows is that case, written down.

If you find yourself needing this more than about once a year, that is the
signal to build the local login instead. Note the date each time you use it.

## Prerequisites

Everything here needs the wrapper's API key. It is host access by definition:
anyone with this key can do all of it, which is exactly why the key never
reaches a browser and why dashboard permissions are not a defence against
someone holding it.

```bash
export MC_API=http://127.0.0.1:3000
export MC_KEY="$(sudo grep -oP '^API_KEY=\K.*' /opt/mc-api-server/.env)"
export MC_ID=survival    # the instance id
```

Adjust the path to your install. If the wrapper is on another machine, SSH
there first rather than opening its port.

## Is anything actually wrong?

```bash
# The wrapper itself. No key needed; this is the uptime-monitor endpoint.
curl -sS $MC_API/health

# The server, three-state: online / unresponsive / offline.
curl -sS -H "x-api-key: $MC_KEY" $MC_API/instances/$MC_ID/health | jq
```

`unresponsive` means the process is up but RCON is not answering — a loaded
server, not a stopped one. Do not restart on that alone.

## Read the log

```bash
curl -sS -H "x-api-key: $MC_KEY" \
  "$MC_API/instances/$MC_ID/logs/tail?lines=200" | jq -r '.lines[]'
```

Follow it live:

```bash
curl -sN -H "x-api-key: $MC_KEY" $MC_API/instances/$MC_ID/logs/stream \
  | sed -u -n 's/^data: //p' | jq -r '.line'
```

## Run a console command

```bash
curl -sS -X POST -H "x-api-key: $MC_KEY" -H 'content-type: application/json' \
  -d '{"command":"list"}' $MC_API/instances/$MC_ID/command | jq -r '.result'
```

The dashboard's deny-list does **not** apply here. It is a policy for dashboard
users, and this path is below it.

## Start, stop, restart, back up

```bash
for action in start stop restart backup rollback; do :; done   # valid actions

curl -sS -X POST -H "x-api-key: $MC_KEY" -H 'content-type: application/json' \
  -d '{"action":"restart"}' $MC_API/instances/$MC_ID/scripts/run | jq
```

`restart` runs `smart_restart.sh`, which warns players first. There is no
un-smart restart.

`rollback` replaces the world from the suite's snapshot and cannot be undone.

## Backups

```bash
# List archives, newest first.
curl -sS -H "x-api-key: $MC_KEY" \
  "$MC_API/instances/$MC_ID/backups/files?limit=20" \
  | jq -r '.files[] | "\(.id)  \(.tier)/\(.name)  \(.sizeBytes)"'

# Download one, by the id from that listing.
curl -sS -H "x-api-key: $MC_KEY" -OJ \
  $MC_API/instances/$MC_ID/backups/files/<ID>/download

# Restore. Destructive, not undoable, no confirmation prompt on this path.
curl -sS -X POST -H "x-api-key: $MC_KEY" \
  $MC_API/instances/$MC_ID/backups/files/<ID>/restore | jq
```

## Fixing the dashboard itself

Once the immediate problem is handled:

```bash
# Is the web process alive?
sudo systemctl status minecraft-bot-web
curl -sS http://127.0.0.1:8080/healthz

# Its own logs.
sudo journalctl -u minecraft-bot-web -n 100 --no-pager
```

Common causes, in the order they usually turn out to be:

**Discord OAuth is failing.** `journalctl` shows the callback erroring. If
Discord's API is down, wait; otherwise check that `webui.publicUrl` still
matches the redirect URI registered on the Discord application.

**You removed yourself from `adminUsers`.** Edit `config.json` on the host and
put yourself back. The fs-watcher picks it up; no restart needed. Note that
sysadmin status is re-derived on every request, so this applies immediately.

**A capability rule is wrong.** If the process refuses to start with a message
about a route declaring no capability, that is the boot assertion doing its
job — a route was added without one. It names the route.

**`config.json` is invalid.** The dashboard refuses to write an invalid config,
but a hand edit can still break it. `journalctl` names the failing path.

## After an outage

Two things worth doing while it is fresh:

- Note the date here, so "how often do I actually need this" is answerable.
- Check the audit log once the dashboard is back. Actions taken through the
  wrapper directly do **not** appear in it — this path is below the dashboard,
  so it records nothing. If someone else may have been working at the same
  time, the wrapper's own logs are the record.
