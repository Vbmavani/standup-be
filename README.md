# Standup Board API

Backend for **Standup Board**, a team async-standup and task board: Node 22, TypeScript, Fastify 5, Redis (ioredis) and zod.

The React frontend is a separate repo, [standup-fe](https://github.com/Vbmavani/standup-fe) (clone it next to this one as `../standup-fe`), served by Vite on **http://localhost:5173**. It proxies `/api` to this server on **http://localhost:4000**.

The full product spec and API contract are in [`docs/PLAN.md`](docs/PLAN.md).

## Quickstart

```bash
pnpm install
cp .env.example .env

# Start Redis on localhost:6379, using either:
pnpm redis                      # docker compose up -d redis (redis:7-alpine)
redis-server --daemonize yes    # or a locally installed redis-server

pnpm dev                        # http://localhost:4000/api/health
```

Then start the web app in `../standup-fe` (`pnpm dev`, port 5173).

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Runs `src/server.ts` with tsx watch |
| `pnpm build` | Compiles TypeScript to `dist/` |
| `pnpm start` | Runs `dist/server.js` |
| `pnpm test` | Runs the Vitest suite. It needs Redis on `localhost:6379` and uses **DB 15**, which is flushed |
| `pnpm typecheck` | Runs `tsc --noEmit` |
| `pnpm redis` | Runs `docker compose up -d redis` |

## Environment

| Variable | Default |
|---|---|
| `PORT` | `4000` |
| `REDIS_URL` | `redis://localhost:6379` |
| `WEB_ORIGIN` | `http://localhost:5173` (CORS origin, sent with credentials) |
| `COOKIE_SECURE` | `false` (set it to `true` behind HTTPS) |

## Layout

```
src/
  server.ts        entry: builds the app and listens
  app.ts           buildApp(): plugins, error handler, route registration
  config.ts        env parsing
  redis.ts         ioredis clients (main + subscriber factory)
  lib/             errors, ids, dates, keys, events (activity + publish), serializers, helpers
  plugins/auth.ts  session cookie → request.user; requireAuth / requireMember
  routes/          health, auth, users, teams, tasks, standups, activity, summary, events (SSE)
test/              vitest, one file per route group
```
