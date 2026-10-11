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
| Why things are the way they are: the decision log | [decisions.md](decisions.md) |
| How Discord replies look: builders, colours, errors, confirm rows, paging, mentions | [bot/replies.md](bot/replies.md) |
| Dashboard frontend: tokens, density, components, routes, `t()`, the hex and literal checks | [web/frontend.md](web/frontend.md) |

## Per workspace

| Workspace | What lives there | Docs |
|---|---|---|
| `@mcbot/bot` | The Discord process: commands, watchers, in-game commands | [bot/](bot/readme.md) |
| `@mcbot/core` | Config, data layer, server access, Minecraft domain | [core/](core/readme.md) |
| `@mcbot/web` | The optional dashboard: Fastify backend + Vue frontend | [web/](web/readme.md) |
| `@mcbot/schema` | Isomorphic contracts shared by all three | [contracts.md](contracts.md) |

`@mcbot/schema` has no directory of its own: it is small, and its whole point
is that every workspace depends on it, which makes it root material.

## Refactor records

[refactor/](refactor/) holds the Wave 1 audit and its [summary](refactor/wave1-summary.md): what changed per phase, what was deferred, how it was verified and the cross-repo merge order.

[wave2-summary.md](wave2-summary.md) records Wave 2 (the dashboard and Discord rework, 8.0.0): what changed per phase, which audit findings were closed, what was deferred, the limits of its verification and the owner decisions. The Wave 2 working material (audit appendices, mockups, spike notes) is still under [refactor/](refactor/) until the owner confirms its removal; [wave2-cleanup-candidates.md](wave2-cleanup-candidates.md) lists it.

## History

[history/](history/) keeps the design records for work that has since shipped
— the dashboard plan and the WebUI integration contract. They are preserved
for their reasoning, not as a description of the code. Where they disagree with
the code, the code wins.
