# Standup Board — product spec & API contract

Standup Board is a team async-standup and task board. Two separate projects make up the product:

| Project  | Folder       | Stack                                                                       | Port     |
| -------- | ------------ | --------------------------------------------------------------------------- | -------- |
| Backend  | `standup-be` | Node 22, TypeScript, Fastify, Redis (ioredis), zod                          | **4000** |
| Frontend | `standup-fe` | React 18, Vite, TypeScript, React Router, TanStack Query, Tailwind, dnd-kit | **5173** |

The frontend calls the backend through the Vite dev proxy (`/api` → `http://localhost:4000`), so the session cookie is same-origin. The API also allows CORS from `http://localhost:5173` with credentials.

**This file is the shared contract.** Both projects keep an identical copy; change both when the API changes.

---

## Features

1. **Auth**: sign up (name, email, password ≥ 8 chars), sign in, sign out, current user. The session is an httpOnly cookie `sid` holding a random token; Redis maps it to the user with a 7-day TTL.
2. **Profile**: change display name.
3. **Teams**: create a team, list my teams, join with an invite code, view members, rename (owner only), regenerate the invite code (owner only), leave.
   - The owner can't leave while other members remain (409). When the last member leaves, the team is deleted.
4. **Daily standup**: one entry per user per team per date (yesterday / today / blockers). Submit or edit it, view the whole team's entries for any date, and see who hasn't posted.
5. **Task board**: a kanban with `todo`, `in_progress` and `done`. Create, edit (title, description, assignee, due date), delete, and drag between and within columns. Moving into `done` sets `completedAt`; moving out of it clears it.
6. **Activity feed**: each mutation is appended to a capped Redis stream (~1000 entries).
7. **Live updates**: Server-Sent Events per team. Every mutation publishes to Redis pub/sub, and every connected client refetches the affected data.
8. **Weekly summary**: for a week starting on a given Monday, it shows tasks created and completed, standups submitted per member, and every reported blocker.

## Status checklist

- [ ] API: auth, users, teams, tasks, standups, activity, summary, events, tests
- [ ] Web: auth pages, teams page, team layout, standup, board, activity, summary, settings, profile, live updates

---

## Redis data model

| Key                        | Type           | Content                                                                                                   |
| -------------------------- | -------------- | --------------------------------------------------------------------------------------------------------- |
| `user:{id}`                | hash           | id, name, email, passwordHash, createdAt                                                                  |
| `user:email:{email}`       | string         | userId (email lowercased)                                                                                 |
| `session:{token}`          | string, TTL 7d | userId                                                                                                    |
| `user:{id}:teams`          | set            | teamIds                                                                                                   |
| `team:{id}`                | hash           | id, name, ownerId, inviteCode, createdAt                                                                  |
| `team:{id}:members`        | set            | userIds                                                                                                   |
| `invite:{code}`            | string         | teamId                                                                                                    |
| `task:{id}`                | hash           | id, teamId, title, description, status, assigneeId, dueDate, createdBy, createdAt, updatedAt, completedAt |
| `team:{id}:col:{status}`   | list           | ordered taskIds for that column                                                                           |
| `standup:{teamId}:{date}`  | hash           | userId → JSON `{yesterday, today, blockers, updatedAt}`                                                   |
| `team:{id}:activity`       | stream         | `type`, `actorId`, `data` (JSON)                                                                          |
| channel `team:{id}:events` | pub/sub        | JSON `{ "type": EventType }`                                                                              |

IDs are `crypto.randomUUID()`. Invite codes are 8 uppercase alphanumeric characters. Dates are `YYYY-MM-DD` and timestamps are ISO strings. Empty optional fields are stored as `""` and returned as `null`.

---

## Shared types (JSON)

```ts
type User = { id: string; name: string; email: string; createdAt: string };

type Team = {
  id: string;
  name: string;
  ownerId: string;
  inviteCode: string;
  createdAt: string;
  memberCount: number;
};

type Member = { id: string; name: string; email: string; isOwner: boolean };

type TaskStatus = 'todo' | 'in_progress' | 'done';

type Task = {
  id: string;
  teamId: string;
  title: string;
  description: string;
  status: TaskStatus;
  assigneeId: string | null;
  dueDate: string | null; // YYYY-MM-DD
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

type StandupEntry = {
  userId: string;
  userName: string;
  date: string;
  yesterday: string;
  today: string;
  blockers: string;
  updatedAt: string;
};

type ActivityType =
  | 'team.created'
  | 'team.renamed'
  | 'member.joined'
  | 'member.left'
  | 'task.created'
  | 'task.updated'
  | 'task.moved'
  | 'task.deleted'
  | 'standup.submitted';

type ActivityItem = {
  id: string; // stream entry id
  type: ActivityType;
  actorId: string;
  actorName: string;
  createdAt: string;
  data: Record<string, unknown>; // e.g. { taskId, title, from, to } or { date } or { name }
};

type EventType = 'tasks' | 'standups' | 'activity' | 'team' | 'members';

type ApiError = { error: { code: string; message: string } };
```

Error codes: `VALIDATION_ERROR` (400), `UNAUTHORIZED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404), `CONFLICT` (409), `INTERNAL` (500).

---

## API endpoints (prefix `/api`)

Every route except `health`, `auth/signup` and `auth/signin` needs a valid session (401 otherwise). Every `/teams/:teamId/**` route also needs team membership (404 if the team doesn't exist, 403 if the user isn't a member).

### Health

| Method | Path      | Body | Response                        |
| ------ | --------- | ---- | ------------------------------- |
| GET    | `/health` |      | `200 { ok: true, redis: "up" }` |

### Auth

| Method | Path            | Body                        | Response                                                             |
| ------ | --------------- | --------------------------- | -------------------------------------------------------------------- |
| POST   | `/auth/signup`  | `{ name, email, password }` | `201 { user }` and sets the cookie. 409 if the email is taken        |
| POST   | `/auth/signin`  | `{ email, password }`       | `200 { user }` and sets the cookie. 401 if the credentials are wrong |
| POST   | `/auth/signout` |                             | `204` and clears the cookie and session                              |
| GET    | `/auth/me`      |                             | `200 { user }` or 401                                                |

### Users

| Method | Path        | Body       | Response       |
| ------ | ----------- | ---------- | -------------- |
| PATCH  | `/users/me` | `{ name }` | `200 { user }` |

### Teams

| Method | Path                        | Body             | Response                                                          |
| ------ | --------------------------- | ---------------- | ----------------------------------------------------------------- |
| GET    | `/teams`                    |                  | `200 { teams: Team[] }` sorted by name                            |
| POST   | `/teams`                    | `{ name }`       | `201 { team }` (creator becomes owner and member)                 |
| POST   | `/teams/join`               | `{ inviteCode }` | `200 { team }`. 404 if the code is invalid. Joining twice is fine |
| GET    | `/teams/:teamId`            |                  | `200 { team, members: Member[] }`                                 |
| PATCH  | `/teams/:teamId`            | `{ name }`       | `200 { team }`. Owner only, 403 otherwise                         |
| GET    | `/teams/:teamId/members`    |                  | `200 { members: Member[] }`                                       |
| POST   | `/teams/:teamId/invite`     |                  | `200 { team }` with a new inviteCode. Owner only                  |
| DELETE | `/teams/:teamId/members/me` |                  | `204`. 409 if the owner leaves while others remain                |

### Tasks

| Method | Path                                | Body                                                                          | Response                                                                                      |
| ------ | ----------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| GET    | `/teams/:teamId/tasks`              |                                                                               | `200 { columns: { todo: Task[], in_progress: Task[], done: Task[] } }` in column order        |
| POST   | `/teams/:teamId/tasks`              | `{ title, description?, assigneeId?, dueDate?, status? }`                     | `201 { task }`, appended to the end of its column                                             |
| PATCH  | `/teams/:teamId/tasks/:taskId`      | `{ title?, description?, assigneeId?: string\|null, dueDate?: string\|null }` | `200 { task }`                                                                                |
| POST   | `/teams/:teamId/tasks/:taskId/move` | `{ status, index }`                                                           | `200 { task }`. `index` is the 0-based position in the target column after the move (clamped) |
| DELETE | `/teams/:teamId/tasks/:taskId`      |                                                                               | `204`                                                                                         |

`assigneeId` must be a team member (400 otherwise). `title` is 1–200 characters and `description` at most 5000.

### Standups

| Method | Path                         | Query/Body                                 | Response                                                                                 |
| ------ | ---------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------- |
| GET    | `/teams/:teamId/standups`    | `?date=YYYY-MM-DD` (default: today in UTC) | `200 { date, entries: StandupEntry[], missing: Member[] }`                               |
| PUT    | `/teams/:teamId/standups/me` | `{ date?, yesterday, today, blockers }`    | `200 { entry }` (upsert). Each field is at most 2000 characters, and `today` is required |

The frontend always sends the user's local date.

### Activity

| Method | Path                      | Query               | Response                                      |
| ------ | ------------------------- | ------------------- | --------------------------------------------- |
| GET    | `/teams/:teamId/activity` | `?limit=50` (1–200) | `200 { items: ActivityItem[] }`, newest first |

### Summary

| Method | Path                     | Query                                                             | Response  |
| ------ | ------------------------ | ----------------------------------------------------------------- | --------- |
| GET    | `/teams/:teamId/summary` | `?weekStart=YYYY-MM-DD` (default: Monday of the current UTC week) | see below |

```ts
{
  weekStart: string;
  weekEnd: string; // weekEnd = weekStart + 6 days
  totals: {
    tasksCreated: number;
    tasksCompleted: number;
    standupsSubmitted: number;
    blockers: number;
  }
  members: {
    userId: string;
    name: string;
    standupsSubmitted: number;
    tasksCreated: number;
    tasksCompleted: number;
  }
  [];
  blockers: {
    userId: string;
    name: string;
    date: string;
    text: string;
  }
  []; // non-empty blockers, by date
}
```

`tasksCompleted` is counted from `completedAt` and credited to the assignee, or to the creator when there's no assignee.

### Live events

| Method | Path                    | Response                                                                                            |
| ------ | ----------------------- | --------------------------------------------------------------------------------------------------- |
| GET    | `/teams/:teamId/events` | `text/event-stream`. Each message is `data: {"type":"tasks"}`. A `: ping` comment is sent every 25s |

Which event each mutation publishes:

- task changes → `tasks` + `activity`
- standup upsert → `standups` + `activity`
- rename / invite regenerate → `team` (rename also sends `activity`)
- join / leave → `members` + `team` + `activity`

---

## Frontend pages

| Route                 | Page                                                                                                                                         |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `/signin`, `/signup`  | Public auth forms. Redirect to `/teams` when already signed in                                                                               |
| `/teams`              | My teams, plus create team and join-by-code forms                                                                                            |
| `/t/:teamId`          | Team layout: sidebar (Standup · Board · Activity · Summary · Settings), team switcher, user menu (Profile, Sign out). Redirects to `standup` |
| `/t/:teamId/standup`  | Date picker, my entry form for the selected date, team entry cards, "Not posted yet" list                                                    |
| `/t/:teamId/board`    | Three-column drag-and-drop kanban, with a modal for creating, editing and deleting tasks (assignee select, due date)                         |
| `/t/:teamId/activity` | Activity feed with readable messages and relative times                                                                                      |
| `/t/:teamId/summary`  | Week picker (previous/next week), stat cards, per-member table, blockers list                                                                |
| `/t/:teamId/settings` | Team name (editable by owner), invite code with copy and regenerate buttons, members list, leave team                                        |
| `/profile`            | Edit display name                                                                                                                            |
| `*`                   | 404 page                                                                                                                                     |

`useTeamEvents(teamId)` opens an `EventSource('/api/teams/:teamId/events')` (credentials are same-origin through the proxy). When a message arrives, it invalidates the matching TanStack Query keys: `['tasks', teamId]`, `['standups', teamId]`, `['activity', teamId]`, `['team', teamId]` and `['teams']`.
