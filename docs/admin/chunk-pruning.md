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

## Terrain view

Switch the map to **Terrain** and zoom in (about 2.5 pixels per chunk or closer): each region is drawn from
above, one pixel per block, with the class colours laid over it. Untick **Chunk colours** to see the bare
terrain; your selection, protected zones and the grid stay, and hovering a chunk still names its class.
It is a picture to orient by, not a
renderer: no biome colours, water darker the deeper it is, and a hint of relief. A region is drawn on the host
the first time it is looked at and kept (up to 500 MB) until the region changes, so the first look at a
large area is slower than the next. Chunks from before 1.18 and chunks that cannot be read stay plain.

## Chunks that look built

Time in use is not proof that nobody built somewhere: a quick build, or work done with an editor,
leaves little. So a chunk the rules would delete is kept as **looks built** (grey on the map) when
it holds chests, barrels, signs, furnaces, beds, redstone parts or modded block entities that no
structure explains. Villages, mineshafts, ruins and dungeons are recognised and do not count.
The check is a hint and can be wrong both ways, which is why it only ever keeps a chunk. Untick
**Keep chunks that look built** to prune by time alone. The **Inspect** tool shows, for any chunk,
what it holds and exactly which rule keeps or deletes it. Only chunks from Minecraft 1.18 and
newer carry the data it reads.

## Using it

1. **Pick the dimensions.** If the world has more than one, tick the ones to scan. Only
   those are read, cached and pruned; the others are not touched. To prune just the Nether,
   untick the rest.
2. **Scan.** Reads the region files of the chosen dimensions and shows how many chunks would
   go, per dimension, and a map: red would be deleted, green is in use, blue is protected,
   violet is buffer, amber is unreadable. A second view shades by time used. While it runs
   you see the regions read, chunks per second and an estimate, and you can stop it. A scan
   changes nothing and is safe on a running server; its answer is approximate while chunks
   are being written. Regions are read on several threads and remembered, so a second scan,
   or one with different numbers, takes seconds (a 1 million chunk world: about 28 s the
   first time on a 4 core host, instead of 4.5 minutes).
3. **Look around.** The map fills the page: scroll to zoom, drag to move (the Move tool, or
   hold Space), pinch on a touch screen, or use the keyboard: focus the map, then the arrow keys
   move a cursor from chunk to chunk (Shift jumps eight), Space chooses or unchooses that chunk, Enter inspects
   it, PageUp and PageDown scroll, plus and minus zoom, and 0 fits the whole world. Hovering a chunk says what it is and how long players were near it.
4. **Adjust.** Change the numbers or draw protected zones (the Protect tool), then scan
   again. A summary made with other settings is marked out of date and cannot be applied.
   **Save as default** keeps the settings for this server.
5. **Choose by hand (optional).** With the Select tool drag rectangles over chunks to delete
   them even where a rule would keep them (in use, or inside the buffer); Alt-drag, or the
   Unselect tool, takes chunks out again; Ctrl+Z and Ctrl+Y undo and redo. Unreadable chunks
   can never be chosen. Spawn, player areas and your protected zones also hold, unless you
   tick **Also allow selecting protected areas** (it asks first). Press **Update preview** to
   see exactly what the delete would then do; the result separates what the rules found,
   what you chose over a rule, and what you chose over a protected area.
6. **Delete.** Asks you to type the server name. The server is stopped, a backup is
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

If a delete ever dies half way (the host loses power, the job is killed), the page shows
**An earlier prune did not finish** and the world may be half pruned. Restore the backup
that job took before pruning again. A delete also stops itself after 45 minutes and rolls
back rather than being cut off in the middle.
