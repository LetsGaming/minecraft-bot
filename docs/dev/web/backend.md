# Dashboard backend

Fastify 5 + TypeScript, same ESM build as everything else. No ORM, no auth
framework — both are hand-rolled, deliberately, because the problem is small and
a framework would be more surface than solution.

## Layout

| Path | Owns |
|---|---|
| `index.ts` | Entry: the `webui.enabled` gate, the server registry, opening the store |
| `server.ts` | Building the Fastify instance: helmet, CSP, rate limiting, static, route registration |
| `errors.ts` | Typed HTTP failures and the single error handler |
| `rateLimit.ts`, `static.ts`, `requiredEnv.ts` | The rest of the app plumbing `server.ts` wires |
| `auth/auth.ts` | Sessions, OAuth, roles, `secretEquals` |
| `auth/discordRest.ts` | The Discord REST client |
| `config/safeConfig.ts` | Masking secrets out, merging placeholders back in |
| `config/configSchema.ts` | The generated schema the config editor renders |
| `status/status.ts` | Collecting server status (the same core layer the bot uses) |
| `status/metrics.ts` | `/healthz` and Prometheus `/metrics` |
| `routes/` | One file per area, plus `schemas.ts` for the TypeBox request shapes |

The root holds the Fastify app itself — the entry, the builder, and the pieces
the builder registers. Everything with a subject of its own goes in a group
named for it.

## The layering

Route → validation → service → data. A handler validates, calls, and returns;
decisions live below it. Concretely: a route may call core, but a route must not
*be* the business rule. If a handler is growing branches, the rule belongs in
core, where the bot can reach it too.

Request shapes are TypeBox schemas in `routes/schemas.ts`, wired through
`withTypeProvider<TypeBoxTypeProvider>()` so params and body are typed from the
schema rather than cast.

## Errors

**Throw a typed failure; never hand-build a response.**

```ts
throw new NotFound(`No server named "${id}" is configured.`);
throw new BadRequest(`unknown action "${action}"`);
```

`errors.ts` defines them, `setErrorHandler` maps each to its status and one
consistent body. The messages on those classes are deliberate and client-safe.
Anything *else* that throws becomes a generic 500 with the detail logged and
nothing leaked.

This replaced ~28 hand-built `reply.code(4xx).send({ error })` calls whose
bodies had drifted into four different shapes (`{error}`, `{error,detail}`,
`{errors:[]}`, and a bare string). If you add a new failure mode, add a class —
do not reach for `reply.code()`.

Do not reconstruct a status from an error message either. Upstream failures
carry a typed `.status`; switch on the value, not on `msg.includes("(403)")`.

## Auth

`auth.ts` is the reference implementation, and any new auth surface should match
it:

- HMAC-SHA256 signed **stateless cookies** — no session store, no user table.
- `timingSafeEqual` for every secret comparison, through `secretEquals()`. `===`
  on a token leaks its prefix through timing; that helper exists so no call site
  has to remember the length-guard the primitive requires.
- OAuth state is itself a signed token with an expiry.
- Roles are **re-derived from config on every request**, so removing a sysadmin
  takes effect immediately rather than at the next login.
- Cookies are `HttpOnly` + `SameSite=Lax`, and `Secure` in production.

Which gate a route needs is in [index.md](index.md#the-two-apis). Get that
decision right before writing the handler.

## Secrets

`safeConfig.ts` masks `token`, `rconPassword`, and `apiKey` on read and merges
the placeholders back on write, so the browser never receives a real secret and
an edit round-trip cannot blank one out.

**A new secret field must be added to `SERVER_SECRET_KEYS`.** Nothing else
enforces this; the first time it is forgotten, the secret ships to the browser
in the config GET.

## Upstream calls

Discord REST and OAuth go out through one client with a timeout and typed
failures. Do not re-implement `fetch` per call site and do not
`res.json() as T` — a changed upstream shape should fail at the boundary with a
named error, not turn into a wrongly-shaped object three layers in.
