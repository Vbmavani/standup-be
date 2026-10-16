import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { addDays, dateSchema, mondayOf } from '../lib/dates.js';
import { keys } from '../lib/keys.js';
import { hashOrNull } from '../lib/serializers.js';
import { parseStoredStandup } from '../lib/standups.js';
import { getUsers } from '../lib/users.js';
import { parse } from '../lib/validate.js';
import { member, memberTeam } from '../plugins/auth.js';
import { TASK_STATUSES, type RouteOptions, type TaskHash } from '../types.js';

const querySchema = z.object({ weekStart: dateSchema.optional() });

type MemberStats = { userId: string; name: string; standupsSubmitted: number; tasksCreated: number; tasksCompleted: number };

const summaryRoutes: FastifyPluginAsync<RouteOptions> = async (app) => {
  const redis = app.redis;

  app.get('/teams/:teamId/summary', { preHandler: member }, async (request) => {
    const team = memberTeam(request);
    const { weekStart = mondayOf() } = parse(querySchema, request.query);
    const weekEnd = addDays(weekStart, 6);
    const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
    const inWeek = (iso: string) => {
      if (!iso) return false;
      const day = iso.slice(0, 10);
      return day >= weekStart && day <= weekEnd;
    };

    // All tasks across the three columns.
    const pipe = redis.pipeline();
    for (const status of TASK_STATUSES) pipe.lrange(keys.column(team.id, status), 0, -1);
    for (const day of days) pipe.hgetall(keys.standup(team.id, day));
    const res = (await pipe.exec()) ?? [];
    const taskIds = res.slice(0, 3).flatMap(([, v]) => v as string[]);
    const standupHashes = res.slice(3).map(([, v]) => (v ?? {}) as Record<string, string>);

    const taskPipe = redis.pipeline();
    for (const id of taskIds) taskPipe.hgetall(keys.task(id));
    const tasks = (taskIds.length ? ((await taskPipe.exec()) ?? []) : [])
      .map(([, v]) => hashOrNull<TaskHash>(v as Record<string, string>))
      .filter((t): t is TaskHash => t !== null);

    const memberIds = await redis.smembers(keys.teamMembers(team.id));
    const standupUserIds = standupHashes.flatMap((h) => Object.keys(h));
    const users = await getUsers(redis, [...memberIds, ...standupUserIds]);
    const nameOf = (id: string) => users.get(id)?.name ?? 'Unknown user';

    const stats = new Map<string, MemberStats>();
    for (const id of memberIds) {
      if (!users.has(id)) continue;
      stats.set(id, { userId: id, name: nameOf(id), standupsSubmitted: 0, tasksCreated: 0, tasksCompleted: 0 });
    }

    let tasksCreated = 0;
    let tasksCompleted = 0;
    for (const t of tasks) {
      if (inWeek(t.createdAt)) {
        tasksCreated++;
        const s = stats.get(t.createdBy);
        if (s) s.tasksCreated++;
      }
      if (t.status === 'done' && inWeek(t.completedAt)) {
        tasksCompleted++;
        const s = stats.get(t.assigneeId || t.createdBy);
        if (s) s.tasksCompleted++;
      }
    }

    let standupsSubmitted = 0;
    const blockers: { userId: string; name: string; date: string; text: string }[] = [];
    days.forEach((date, i) => {
      const hash = standupHashes[i] ?? {};
      const dayBlockers: typeof blockers = [];
      for (const [userId, raw] of Object.entries(hash)) {
        const entry = parseStoredStandup(raw);
        if (!entry) continue;
        standupsSubmitted++;
        const s = stats.get(userId);
        if (s) s.standupsSubmitted++;
        const text = entry.blockers.trim();
        if (text) dayBlockers.push({ userId, name: nameOf(userId), date, text });
      }
      dayBlockers.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
      blockers.push(...dayBlockers);
    });

    const members = [...stats.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

    return {
      weekStart,
      weekEnd,
      totals: { tasksCreated, tasksCompleted, standupsSubmitted, blockers: blockers.length },
      members,
      blockers,
    };
  });
};

export default summaryRoutes;
