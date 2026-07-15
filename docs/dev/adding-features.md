# Adding features

Where things go. The recipes live with the workspace that owns them; this page
is the router and the checklist.

Before you start: read [architecture.md](architecture.md) once and keep
[coding-guidelines.md](coding-guidelines.md) open.

| I want to add… | Go to |
|---|---|
| A slash command | [bot/commands.md](bot/commands.md) |
| An in-game `!command` | [bot/in-game-commands.md](bot/in-game-commands.md) |
| A log watcher or a scheduled task | [bot/watchers.md](bot/watchers.md) |
| A leaderboard stat | [core/minecraft.md](core/minecraft.md#adding-a-leaderboard-stat) |
| A config field | [core/config.md](core/config.md) + [contracts.md](contracts.md) |
| A notification event | [bot/watchers.md](bot/watchers.md#notifications) |
| A dashboard route | [web/backend.md](web/backend.md) |
| A dashboard view | [web/frontend.md](web/frontend.md) |
| A migration or a new store | [core/data-storage.md](core/data-storage.md) |

## Deciding where it goes

Most of the work is choosing the layer, and the question that decides it is
almost always the same one:

**Does anything else need to know this?** If a value, a format, or a name has to
mean the same thing in two workspaces, it is a contract and it belongs in
`@mcbot/schema` — not a literal in each. See [contracts.md](contracts.md).

**Does it touch a Minecraft server?** Then it goes behind a `serverAccess`
function, so local and remote instances keep working from one implementation.
Callers never import `fs` or `child_process` for server data.

**Is it a decision, or is it plumbing?** Decisions (business rules) live in
core, where the bot and the dashboard can both reach them. Handlers and views
validate, call, and render.

**Does it persist anything?** Machine-written state goes in SQLite behind one
owning store module. Human-edited state stays JSON. See
[core/data-storage.md](core/data-storage.md).

## Checklist before opening a PR

- [ ] `npm run typecheck`, `npm run lint`, `npm test` all clean
- [ ] `npm run schema:check` clean — regenerate if you touched a config type
- [ ] `npm run i18n:check` clean — `en` and `de` stay in parity
- [ ] New behaviour covered by tests; a bug fix has a regression test that fails
      without the fix
- [ ] User-visible changes documented under `docs/`
- [ ] An entry in [decisions.md](decisions.md) if the change makes a non-obvious
      architectural choice
- [ ] No rule from [coding-guidelines.md](coding-guidelines.md) violated

CI runs the same gates, plus `npm audit --audit-level=high`.
