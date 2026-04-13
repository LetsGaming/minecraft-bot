# Sudoers Setup

The `/server start`, `/server stop`, `/server restart`, and `/server backup` commands need to run shell scripts on the host machine. These scripts use `systemctl` to manage the Minecraft server service, which requires `sudo`. Because the bot runs non-interactively (no terminal, no password prompt), **passwordless sudo** must be configured for two hops:

| Hop | What happens | Why sudo is needed |
|---|---|---|
| **Layer 1** | The bot's OS user runs a script as the Minecraft linux user via `sudo -u` | The bot process doesn't run as the same user that owns the server files |
| **Layer 2** | The script calls `sudo systemctl start/stop/restart` | `systemctl` service management requires root privileges |

If either hop isn't configured, the bot will show a clear error message in Discord explaining which layer failed.

## Prerequisites

You need to know two usernames:

- **Bot user** — the OS user that runs the Discord bot (whoever starts PM2 or `node`). Find it with `whoami` in the terminal where you run the bot.
- **Minecraft user** — the `linuxUser` value from your `config.json` server entry (default: `minecraft`). This user owns the server files and screen session.

In the examples below, we'll use `discord-bot` and `minecraft` respectively. Replace them with your actual usernames.

## Setup

### 1. Create a sudoers drop-in file

Always use `visudo` to edit sudoers files — it validates syntax and prevents lockouts.

```bash
sudo visudo -f /etc/sudoers.d/minecraft-bot
```

### 2. Add the rules

Paste the following (replace usernames and service names as needed):

```sudoers
# ── Layer 1: Bot user can switch to the minecraft user ──
discord-bot ALL=(minecraft) NOPASSWD: ALL

# ── Layer 2: Minecraft user can manage its own systemd services ──
minecraft ALL=(ALL) NOPASSWD: /usr/bin/systemctl start minecraft-*.service
minecraft ALL=(ALL) NOPASSWD: /usr/bin/systemctl stop minecraft-*.service
minecraft ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart minecraft-*.service
minecraft ALL=(ALL) NOPASSWD: /usr/bin/systemctl enable minecraft-*.service
```

**If your service names don't follow the `minecraft-*` pattern**, replace the wildcard with explicit service names. For example, if your `screenSession` / `INSTANCE_NAME` is `survival`:

```sudoers
minecraft ALL=(ALL) NOPASSWD: /usr/bin/systemctl start survival.service
minecraft ALL=(ALL) NOPASSWD: /usr/bin/systemctl stop survival.service
minecraft ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart survival.service
minecraft ALL=(ALL) NOPASSWD: /usr/bin/systemctl enable survival.service
```

Add a block for each server instance.

### 3. Set correct permissions

```bash
sudo chmod 0440 /etc/sudoers.d/minecraft-bot
```

## Verification

Test both layers manually before using the bot commands.

### Test Layer 1 (user switch)

Run this as the **bot user**:

```bash
sudo -n -u minecraft whoami
```

Expected output: `minecraft`

If you see `sudo: a password is required`, Layer 1 is not configured correctly.

### Test Layer 2 (systemctl)

Run this as the **minecraft user** (or via `sudo -u minecraft`):

```bash
sudo -n systemctl status survival.service
```

Replace `survival.service` with your actual service name. It should print the service status without asking for a password.

If you see `sudo: a password is required`, Layer 2 is not configured correctly.

### Test the full chain

Run this as the **bot user** to simulate exactly what the bot does:

```bash
sudo -n -u minecraft bash -c 'sudo -n systemctl status survival.service'
```

If this works, the bot's `/server` commands will work too.

## What happens without sudoers

The bot itself runs fine — all features that don't need `sudo` keep working normally (RCON commands, chat bridge, status embeds, stats, TPS monitoring, etc.).

Only the `/server` subcommands (`start`, `stop`, `restart`, `backup`, `status`) are affected. When sudo is misconfigured, the bot responds with a Discord embed explaining which layer failed and points to this document.

## Troubleshooting

**"Bot user cannot switch to minecraft via sudo -u"**
→ Layer 1 is missing or wrong. Check that the bot's actual OS username matches the sudoers rule.

**"The minecraft user cannot run systemctl via sudo"**
→ Layer 2 is missing or wrong. Check that the service name in the sudoers rule matches `INSTANCE_NAME` from `variables.txt` (or `screenSession` from `config.json`), followed by `.service`.

**Commands time out instead of showing an error**
→ Sudo might be prompting for a password interactively instead of failing immediately. Make sure the bot code uses `sudo -n` (the `-n` flag prevents password prompts). If you're on an older version, update the bot.

**"User is not in the sudoers file. This incident will be reported."**
→ The sudoers rule doesn't exist or has a syntax error. Re-run `sudo visudo -f /etc/sudoers.d/minecraft-bot` and check for typos. Verify with `sudo -l -U minecraft` to list what the user is allowed to do.

## Security Notes

- The Layer 1 rule (`discord-bot ALL=(minecraft) NOPASSWD: ALL`) allows the bot user to run **any** command as the minecraft user. If you want to restrict this further, you can limit it to specific script paths:
  ```sudoers
  discord-bot ALL=(minecraft) NOPASSWD: /usr/bin/bash /home/minecraft/minecraft-server/scripts/*
  ```
- The Layer 2 rules are already scoped to specific `systemctl` actions and service names.
- Never add the bot user to the `sudo` group or give it blanket `NOPASSWD: ALL` for root.
