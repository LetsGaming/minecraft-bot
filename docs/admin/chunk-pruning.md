# Pruning unused chunks

The dashboard's **Prune chunks** page deletes generated chunks nobody has used, so
the next Minecraft version's world generation fills that space with new terrain,
biomes and structures. It needs the `server:update` capability on the server (see
[capabilities.md](capabilities.md)) and a setup suite with `world/prune-chunks.js`;
the page says so and stays empty when the server cannot do it.

## What counts as unused

A chunk is a candidate when players spent less than a threshold of time near it
(its `InhabitedTime`; default 5 minutes). These are never deleted, whatever the
threshold:

- chunks around the world spawn and around where each player was last seen;
- zones you draw on the map or type in, per dimension, in chunk coordinates
  (block coordinates divided by 16);
- chunks that cannot be read or carry no time (including LZ4-compressed ones, for
  now);
- a buffer of chunks around everything that stays, so a build does not end at a seam
  of fresh terrain.

Region, entities and poi data are removed together, so no entity or point of interest
is left behind. The setup suite's [chunk-pruning.md](https://github.com/LetsGaming/minecraft-server-setup/blob/main/docs/chunk-pruning.md)
has the details of the engine.

## Using it

1. **Scan.** Reads every region file and shows how many chunks would go, per
   dimension, and a map: red would be deleted, green is in use, blue is protected,
   violet is buffer, amber is unreadable. A second view shades by time used. A scan
   changes nothing and is safe on a running server; its answer is approximate while
   chunks are being written.
2. **Adjust.** Change the numbers or draw protected zones, then scan again. A summary
   made with other settings is marked out of date and cannot be applied. **Save as
   default** keeps the settings for this server.
3. **Delete.** Asks you to type the server name. The server is stopped, a backup is
   taken, the plan is applied, and the server is started. A fresh scan has to still
   agree with at least 90 % of the plan; the job deletes only what both scans agree on.
   If the delete fails or the server does not come up, the job's own backup is restored.

The same scan can be part of a version upgrade: tick **Prune unused chunks** on the
Upgrade page. The prune then runs after the install and before the first start of the
new version, under the upgrade's single backup, so a failed prune rolls the whole
upgrade back. The new version never spends time converting chunks that are about to
be deleted.

Progress is the same as an upgrade's: live on the page, and one message in the
downtime alert channel on Discord.
