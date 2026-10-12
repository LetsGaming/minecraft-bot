# Upgrading a server's Minecraft version

The dashboard's **Upgrade** page moves a server to another Minecraft version in
one supervised job. It needs the `server:update` capability on the server (see
[capabilities.md](capabilities.md)); a sysadmin has it implicitly. The page says
so and stays empty when the server's API wrapper or setup suite is too old.

## What happens

1. **Check.** The target version, the Java it needs and every installed mod's
   verdict are looked up. Nothing changes yet.
2. **Warn players.** In game, for the countdown you chose (default 30 seconds).
3. **Save and stop.** The world is saved and the service stopped.
4. **Backup.** A full archive in `archives/update`. If it fails, nothing was
   changed and the server is started again.
5. **Install.** The new server jar, then the mods.
6. **Start and watch.** The server must print its `Done` line. A crash loop
   (`logs/lifecycle.ndjson`) or no `Done` within five minutes counts as failed.
7. **If it fails and some mods have no build for the new version:** exactly
   those mods are disabled (moved to `mods/disabled/`, reversible) and the
   server starts again.
8. **If it still fails:** the backup from step 4 is restored, the version record
   is put back and the old version starts.

The first start keeps mods that have no build, because a mod that still loads
on the new version is not lost for nothing. When that works the result lists
them as running on an older build; such a mod can still misbehave in game.

## Before you press the button

- Run the mods check for the target. The upgrade refuses to start if the
  installed mods changed since the check you saw.
- The confirmation asks for the server name. After the first start the world is
  converted to the new version; going back to the backup loses what players did
  since. That is why the capability is irreversible-level.
- Without `mods:read` the check is skipped (the page says so) and mods without a
  build are handled the same way.
- While the job runs, stop, restart, rollback, backup, restore and mod changes
  are refused with "busy" instead of racing it, from the dashboard and from SSH.

## Where to follow it

The page shows the phases live and survives a reload. Discord shows one message
per upgrade in the downtime alert channel, edited as it goes, and downtime alerts
stay quiet for the duration. If the wrapper restarts mid-job, the result is still
reported from the script's status file, or as "interrupted" when the script died.
