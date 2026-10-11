# Upgrading to 8.0

8.0.0 needs no config edit and no migration step. One default changed, and it
changes who gets pinged.

## Alerts ping less by default

`mentionPolicy` in `guilds.<id>.downtimeAlerts` and `guilds.<id>.tpsAlerts`
now defaults to `"escalation"`. A guild that sets a `mentionRole` but no
`mentionPolicy` is pinged:

| | Before 8.0.0 | From 8.0.0 |
|---|---|---|
| First failure (server down, disk full, backups too old, TPS low) | Ping | Ping |
| Severity rises (TPS drops below 10, crash loop after an outage) | Ping | Ping |
| Repeat while it stays bad (the 5 minute TPS reminder) | Ping | Posted without a ping |
| Recovery ("back online", "disk space recovered", TPS back to normal) | Ping | Posted without a ping |

Every alert is still posted to the channel; only the ping changes.

## Keeping the old behaviour

Add `"mentionPolicy": "always"` to each block that has a `mentionRole`:

```json
"downtimeAlerts": {
  "channelId": "234567890123456789",
  "mentionRole": "456789012345678901",
  "mentionPolicy": "always"
},
"tpsAlerts": {
  "channelId": "234567890123456789",
  "mentionRole": "456789012345678901",
  "mentionPolicy": "always"
}
```

A value other than `"always"` or `"escalation"` is a config error.

See [configuration.md](configuration.md#alert-mentions) for the full
reference and `CHANGELOG.md` for everything else in 8.0.0.
