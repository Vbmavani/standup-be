# standup-be: Standup Board API

REST + SSE backend for **Standup Board**, a team async-standup and kanban board. Users sign up, create or join teams with an invite code, post daily standups, move tasks on a board, and get live updates.

- **Frontend:** separate repo `../standup-fe` (React, port 5173) – https://github.com/Vbmavani/standup-fe
- **Spec + API contract:** `docs/PLAN.md`. Read it before changing any endpoint, payload, status code or Redis key.

> **IMPORTANT:** `docs/PLAN.md` exists in both repos and must stay identical. If you change the API, update `docs/PLAN.md` here **and** in `../standup-fe/docs/PLAN.md`, and say so in your summary.

## Quick facts

|            |                                                                                            |
| ---------- | ------------------------------------------------------------------------------------------ |
| Runtime    | Node 22 (`.nvmrc`), pnpm 11 (pinned in `package.json`)                                     |
| Language   | TypeScript strict, ESM (`"type": "module"`)                                                |
| Framework  | Fastify 5, `@fastify/cookie`, `@fastify/cors`                                              |
| Data       | Redis via `ioredis` (no SQL database)                                                      |
| Validation | zod 4                                                                                      |
| Auth       | email + password (bcryptjs), httpOnly cookie `sid` → `session:{token}` in Redis, 7-day TTL |
| Tests      | Vitest + `app.inject`, real Redis **DB 15** (flushed per test file)                        |
| Port       | API `http://localhost:4000`, all routes under `/api`                                       |

## Commands

```bash
pnpm install            # also installs Husky git hooks (prepare script)
pnpm redis              # start Redis in Docker (or run a local redis-server)
pnpm dev                # tsx watch on :4000
pnpm test               # vitest run (needs Redis on localhost:6379)
pnpm typecheck          # tsc --noEmit (TypeScript 7)
pnpm lint               # eslint .        | pnpm lint:fix to autofix
pnpm format             # prettier --write | pnpm format:check to verify
pnpm check              # lint + format:check + typecheck + test
pnpm build && pnpm start
```

Run one test file with `pnpm vitest run test/tasks.test.ts`, or one test with `-t "moves within a column"`.

## Definition of done

Before you say a task is finished:

1. `pnpm lint`, `pnpm typecheck` and `pnpm test` pass. `pnpm check` runs all three plus `format:check`, and the pre-push hook runs it too.
2. API changes are reflected in `docs/PLAN.md` in **both** repos.
3. New endpoints have a test in `test/` (`test/<area>.test.ts`).

## Where things live

```
src/
  server.ts          entry: loads config, buildApp(), listen
  app.ts             buildApp(): plugins, CORS, error + 404 handlers, registers every route file
  config.ts          env parsing (PORT, REDIS_URL, WEB_ORIGIN, COOKIE_SECURE)
  redis.ts           ioredis client factory (main + duplicate() for subscribers)
  types.ts           domain types (User, Team, Task, StandupEntry, ActivityType, EventType, ...)
  plugins/auth.ts    session cookie → request.user; guards `authed`, `member`; helpers authUser(), memberTeam()
  lib/
    keys.ts          ALL Redis key builders. Never hand-write a key string
    errors.ts        AppError + badRequest / unauthorized / forbidden / notFound / conflict
    validate.ts      parse(schema, value) → typed value or 400 VALIDATION_ERROR
    events.ts        emit(redis, teamId, eventTypes, activity?) → XADD activity + PUBLISH live events
    serializers.ts   Redis hash → JSON (serializeUser / Team / Member / Task). Never returns passwordHash
    dates.ts         dateSchema (YYYY-MM-DD), todayUtc, mondayOf, addDays, nowIso
    ids.ts           newId (uuid), newSessionToken, newInviteCode
    users.ts teams.ts standups.ts   small domain read helpers
  routes/            one Fastify plugin per area: health auth users teams tasks standups activity summary events
test/
  helpers.ts         createTestApp(), signup(), as(app, cookie).get/post/put/patch/delete, createTeam()
  <area>.test.ts     one file per route group
docs/PLAN.md         product spec, Redis data model, full API contract
```

## Recipe: add or change an endpoint

1. Update the contract in `docs/PLAN.md` (both repos).
2. In `src/routes/<area>.ts`:
   - add a zod schema next to the route and read input with `parse(schema, request.body)`
   - protect it with `{ preHandler: authed }` or `{ preHandler: member }` (member also checks `/teams/:teamId` exists and the user belongs to it)
   - get the user with `authUser(request)` and the team with `memberTeam(request)`
   - build Redis keys only with `keys.*` from `lib/keys.ts`
   - throw `notFound()`, `forbidden()`, `conflict(msg)` or `badRequest(msg)`. Never `reply.code(...).send({error})` by hand
   - return JSON through a serializer from `lib/serializers.ts`
3. If it changes team data, call `emit(app.redis, teamId, ['tasks', 'activity'], { type, actorId, data })`. The event types in use are `tasks | standups | activity | team | members`.
4. If you added a new route file, register it in `src/app.ts`.
5. Add tests in `test/<area>.test.ts` using `createTestApp()`, `signup()` and `as(app, cookie)`.
6. Run `pnpm check`.

## Rules

**MUST**

- Validate every body and query with zod via `parse()`. Errors are always shaped `{ error: { code, message } }`.
- Use `.js` extensions in relative imports (`'../lib/keys.js'`), because this is ESM compiled by tsc.
- Keep route handlers thin. Put reusable Redis reads in `src/lib/<domain>.ts`.
- Do multi-step writes in one `pipeline()`/`multi()`, or in a Lua script when ordering matters (see the task move in `routes/tasks.ts`).
- Keep response shapes and status codes exactly as `docs/PLAN.md` says. The frontend depends on them.

**NEVER**

- Return or log `passwordHash`, session tokens or cookies.
- Invent a new Redis key prefix without adding it to `lib/keys.ts` and the data model table in `docs/PLAN.md`.
- Use `WATCH` on the shared Redis connection. It isn't safe across concurrent requests; use a Lua script instead.
- Edit `.env` files or `pnpm-lock.yaml` by hand, or touch `dist/`.
- Commit with `--no-verify`. Fix whatever the hook reports instead.
- Flush Redis DB 0, which holds local dev data. Tests use DB 15, and only tests flush it.
- Push to `main`. Push a branch and open a PR.

## Gotchas

- **TypeScript alias:** `typescript` in `package.json` is aliased to `@typescript/typescript6`, because typescript-eslint needs the TS 6 API. The real compiler is `@typescript/native` (TS 7), which `tsc` runs. Don't "fix" this alias.
- **pnpm 11** blocks dependency install scripts unless they're listed in `pnpm-workspace.yaml` under `allowBuilds` (esbuild is, for tsx).
- **Redis must be running** for `pnpm test`, `pnpm check` and the pre-push hook. Check with `redis-cli ping` (expects `PONG`).
- **SSE** (`routes/events.ts`) uses `reply.hijack()` and one `redis.duplicate()` subscriber per client. Clean up on socket close, and set CORS headers manually there.
- **CORS** allows only `WEB_ORIGIN` (default `http://localhost:5173`) with credentials.
- **Dates** are `YYYY-MM-DD` strings. The server's "today" and "this week" are UTC; the frontend always sends the user's local date.

## Git

- Work on a branch (currently `agent-playground`) and open a PR into `main`. Never push to `main` directly. Use conventional commit messages: `feat:`, `fix:`, `chore:`, `docs:`, `test:`, `style:`.
- Husky hooks: **pre-commit** runs lint-staged (eslint --fix + prettier on staged files), **pre-push** runs `pnpm check`.
- Personal, uncommitted notes go in `CLAUDE.local.md`, which is gitignored.
