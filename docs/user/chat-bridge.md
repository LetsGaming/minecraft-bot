# The chat bridge

If your server has a chat bridge channel, Discord and Minecraft share one conversation. No commands needed; it just works.

## Minecraft → Discord

Everything you type in the Minecraft chat shows up in the bridge channel as an embed with your player head and name. Exceptions:

- Messages starting with `!` are treated as [in-game commands](in-game-commands.md) and stay in the game.
- System messages (joins, deaths, advancements) are not part of the bridge; they have their own notifications channel if the admin enabled it.

On setups with multiple Minecraft servers, the embed footer tells you which server the message came from.

## Discord → Minecraft

Type a normal message in the bridge channel and it appears in the game chat as:

```
[YourDiscordName] your message
```

A few practical limits, so the game chat stays clean and safe:

- Your display name is capped at 32 characters, the message at 160.
- Unicode text (umlauts, accents, emoji) is forwarded as written — `Grüße ✨` arrives as `Grüße ✨`. Only invisible control characters are removed, and long messages are shortened to fit Minecraft's chat limit.
- Messages from bots are ignored, so two bots cannot loop each other.

There is also `/say message:...` which does the same thing from any channel, useful when you are not in the bridge channel.

## Who sees what

| You write in | Seen by |
|---|---|
| Minecraft chat | Everyone in-game, plus everyone in the Discord bridge channel |
| The bridge channel | Everyone in that channel, plus everyone in-game |
| `!commands` in Minecraft | Only you (private reply, nothing bridged) |

In short: treat the bridge channel like an extension of the in-game chat, because that is exactly what it is.
