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


## Who sees what

| You write in | Seen by |
|---|---|
| Minecraft chat | Everyone in-game, plus everyone in the Discord bridge channel |
| The bridge channel | Everyone in that channel, plus everyone in-game |
| `!commands` in Minecraft | Only you (private reply, nothing bridged) |

In short: treat the bridge channel like an extension of the in-game chat, because that is exactly what it is.

If your server is in a relay group, other Discord servers also see your messages, see [Messages forwarded to other Discord servers](#messages-forwarded-to-other-discord-servers).

## Messages forwarded to other Discord servers

Some servers are connected: what you write in the bridge channel also appears in the bridge channels of other Discord servers that play on the same Minecraft server. A pinned message in the channel says so and lists those servers. Nothing is forwarded unless a bot admin set it up.

What the other servers see:

- **Your name.** If you linked your account with `/link`, your Minecraft name. Otherwise the first letter of your Discord name, `***` and a short tag, for example `S***#a4f2`. The tag stays the same every time, so people can tell two speakers apart, and means nothing outside the group.
- **The server it came from**, in brackets after the name: `S***#a4f2 [Alpha]`.
- **Plain text only.** Mentions become `@user`, `@role` or `#channel`, `@everyone` becomes the word "everyone", custom emoji show as `:name:`, Discord links and invites become `[link]` and `[invite]`, files and images become `[image]` or `[file]`, and a reply is shown as `(reply)` without the text you replied to. Nobody gets pinged.
- **No avatar and no Discord ID.**

Edits and deletes follow: if you edit or delete a message within the first hour, the copies change too.

In the game, your Discord messages use the same name, so the shortened name holds there as well.

### Keeping your messages in your own server

- Press **Don't forward my messages** on the pinned notice, or run `/bridge optout`.
- `/bridge optin` turns forwarding back on.
- The choice applies to the Discord server where you make it. Opting out here does not change anything in another server.
- Your messages still reach the Minecraft server. A 🚫 reaction on a message means it stayed local. A ⏳ reaction means you were sending too fast: if the message still shows up in game, only the forwarding to other servers was skipped.
- Server admins can also stop relaying for specific people.
