# Standup Board API

Backend for Standup Board, a team async-standup and task board. The frontend lives in a separate project, `../standup-fe`.

- Full product spec and **API contract**: `docs/PLAN.md`. Keep it in sync with `../standup-fe/docs/PLAN.md` whenever the API changes.

## Stack

Node 22 · TypeScript (ESM, strict) · Fastify 5 · Redis via ioredis · zod validation · bcryptjs · Vitest

## Ports & services

- API: `http://localhost:4000` (all routes under `/api`)
- Redis: `localhost:6379`. Start it with `pnpm redis` (Docker) or a local `redis-server`
- Allowed CORS origin: `http://localhost:5173` (the web app)

## Commands

```bash
pnpm install
pnpm redis        # docker compose up -d redis
pnpm dev          # tsx watch, port 4000
pnpm test         # vitest (uses Redis DB 15, flushed per test file)
pnpm typecheck
pnpm build && pnpm start
```

## Environment (`.env`, see `.env.example`)

`PORT=4000`, `REDIS_URL=redis://localhost:6379`, `WEB_ORIGIN=http://localhost:5173`, `COOKIE_SECURE=false`

## Layout

```
src/
  server.ts        # entry: builds the app and listens
  app.ts           # buildApp(): plugins, error handler, route registration
  config.ts        # env parsing
  redis.ts         # ioredis clients (main + subscriber factory)
  lib/             # errors, ids, dates, activity + publish helpers, serializers
  plugins/auth.ts  # session cookie → request.user; requireAuth / requireMember
  routes/          # auth, users, teams, tasks, standups, activity, summary, events
test/              # vitest, one file per route group
```

## Conventions

- Validate every body and query with zod. Validation failures return `400 { error: { code: "VALIDATION_ERROR", message } }`.
- Throw `AppError(status, code, message)` from `lib/errors.ts`, and let the central error handler shape the response.
- Redis key names follow the table in `docs/PLAN.md`. Don't invent new prefixes without updating it.
- Every mutation: write the data, append to `team:{id}:activity` (XADD MAXLEN ~ 1000), and publish to `team:{id}:events`.
- Never return `passwordHash`. Serialize via the helpers in `lib/`.
- Route handlers stay thin. Redis access for each domain lives with that route file or a small `lib/` helper.
