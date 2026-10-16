import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { dateSchema, nowIso, todayUtc } from '../lib/dates.js';
import { emit } from '../lib/events.js';
import { keys } from '../lib/keys.js';
import { parseStoredStandup } from '../lib/standups.js';
import { listMembers } from '../lib/teams.js';
import { parse } from '../lib/validate.js';
import { authUser, member, memberTeam } from '../plugins/auth.js';
import type { RouteOptions, StandupEntry, StoredStandup } from '../types.js';

const querySchema = z.object({ date: dateSchema.optional() });

const field = (name: string) => z.string().max(2000, `${name} must be at most 2000 characters`);

const upsertSchema = z.object({
  date: dateSchema.optional(),
  yesterday: field('yesterday').optional(),
  today: field('today').refine((v) => v.trim().length > 0, { message: 'today is required' }),
  blockers: field('blockers').optional(),
});

const standupRoutes: FastifyPluginAsync<RouteOptions> = async (app) => {
  const redis = app.redis;

  app.get('/teams/:teamId/standups', { preHandler: member }, async (request) => {
    const team = memberTeam(request);
    const { date = todayUtc() } = parse(querySchema, request.query);
    const [raw, members] = await Promise.all([redis.hgetall(keys.standup(team.id, date)), listMembers(redis, team)]);

    const entries: StandupEntry[] = [];
    const missing = [];
    for (const m of members) {
      const stored = parseStoredStandup(raw[m.id]);
      if (stored) entries.push({ userId: m.id, userName: m.name, date, ...stored });
      else missing.push(m);
    }
    entries.sort((a, b) => a.userName.localeCompare(b.userName, undefined, { sensitivity: 'base' }));
    return { date, entries, missing };
  });

  app.put('/teams/:teamId/standups/me', { preHandler: member }, async (request) => {
    const user = authUser(request);
    const team = memberTeam(request);
    const body = parse(upsertSchema, request.body);
    const date = body.date ?? todayUtc();
    const stored: StoredStandup = {
      yesterday: body.yesterday ?? '',
      today: body.today,
      blockers: body.blockers ?? '',
      updatedAt: nowIso(),
    };
    await redis.hset(keys.standup(team.id, date), user.id, JSON.stringify(stored));
    await emit(redis, team.id, ['standups', 'activity'], {
      type: 'standup.submitted',
      actorId: user.id,
      data: { date },
    });
    const entry: StandupEntry = { userId: user.id, userName: user.name, date, ...stored };
    return { entry };
  });
};

export default standupRoutes;
