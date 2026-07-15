# Developer documentation

Start here if you are changing the code.

The docs in this directory are split the same way the repo is. The files in
this root hold what is true across every workspace — the layout, the layering
rules, the review rules, the test setup, the reasoning behind past choices.
Everything below is specific to one workspace, and only that workspace's docs
need to know it.

## Read first

| Topic | File |
|---|---|
| The workspace layout, the layers, and the import rules that hold them apart | [architecture.md](architecture.md) |
| Rules enforced in review, and the definition of done | [coding-guidelines.md](coding-guidelines.md) |
| `@mcbot/schema`: what a shared contract is and when something becomes one | [contracts.md](contracts.md) |
| Running and writing tests | [testing.md](testing.md) |
| Where to put a new command, watcher, or stat | [adding-features.md](adding-features.md) |
| Why things are the way they are — the decision log | [decisions.md](decisions.md) |

## Per workspace

| Workspace | What lives there | Docs |
|---|---|---|
| `@mcbot/bot` | The Discord process: commands, watchers, in-game commands | [bot/](bot/index.md) |
| `@mcbot/core` | Config, data layer, server access, Minecraft domain | [core/](core/index.md) |
| `@mcbot/web` | The optional dashboard: Fastify backend + Vue frontend | [web/](web/index.md) |
| `@mcbot/schema` | Isomorphic contracts shared by all three | [contracts.md](contracts.md) |

`@mcbot/schema` has no directory of its own: it is small, and its whole point
is that every workspace depends on it, which makes it root material.

## History

[history/](history/) keeps the design records for work that has since shipped
— the dashboard plan and the WebUI integration contract. They are preserved
for their reasoning, not as a description of the code. Where they disagree with
the code, the code wins.
