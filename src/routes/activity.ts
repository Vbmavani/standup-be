import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { keys } from '../lib/keys.js';
import { getUsers } from '../lib/users.js';
import { parse } from '../lib/validate.js';
import { member, memberTeam } from '../plugins/auth.js';
import type { ActivityItem, ActivityType, RouteOptions } from '../types.js';

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

function fieldsToObject(fields: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i + 1 < fields.length; i += 2) out[fields[i] as string] = fields[i + 1] as string;
  return out;
}

function safeJson(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const v: unknown = JSON.parse(raw);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const activityRoutes: FastifyPluginAsync<RouteOptions> = async (app) => {
  const redis = app.redis;

  app.get('/teams/:teamId/activity', { preHandler: member }, async (request) => {
    const team = memberTeam(request);
    const { limit } = parse(querySchema, request.query);
    const entries = await redis.xrevrange(keys.activity(team.id), '+', '-', 'COUNT', limit);
    const parsed = entries.map(([id, fields]) => ({ id, f: fieldsToObject(fields) }));
    const users = await getUsers(redis, parsed.map((e) => e.f.actorId ?? '').filter(Boolean));
    const items: ActivityItem[] = parsed.map(({ id, f }) => {
      const actorId = f.actorId ?? '';
      return {
        id,
        type: f.type as ActivityType,
        actorId,
        actorName: users.get(actorId)?.name ?? 'Unknown user',
        createdAt: f.createdAt ?? new Date(Number(id.split('-')[0])).toISOString(),
        data: safeJson(f.data),
      };
    });
    return { items };
  });
};

export default activityRoutes;
