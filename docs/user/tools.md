# Tools & Info

## Server Status

`/status` — Shows whether the server is online, how many players are connected, who's online, and the bot's latency.

If your server has a status embed channel, there's also a persistent message that updates automatically — no command needed.

## World Seed

`/seed` — Shows the server's world seed. Useful for plugging into external tools.

## Chunkbase

`/chunkbase` — Generates a link to [Chunkbase](https://www.chunkbase.com), pre-filled with the server's seed. You can pick a dimension (Overworld, Nether, End).

If your account is linked and you're online, the link will be centered on your current coordinates.

## Nether Portal Calculator

`/netherportal` — Tells you the Nether coordinates matching your current Overworld position. Requires a linked account and being online in-game.

The math is simple (divide Overworld X and Z by 8), but this saves you from alt-tabbing to a calculator.

## Player Head

`/playerhead PlayerName` — Shows the player's skin and a button to give yourself their head as an in-game item. Clicking the button requires a linked account and being online.

## Live Map

`/map` — Shows a link to the server's web map (Dynmap, Bluemap, etc.) if one is configured.

## Whitelist

`/whitelisted` — Lists all players on the server whitelist. Paginated if the list is long.

## Multi-Server

If the bot manages multiple servers, most commands accept an optional `server` option. Start typing and Discord will autocomplete the available server names. If you leave it blank, the default server for your Discord guild is used.
