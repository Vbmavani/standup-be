import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { nowIso } from '../lib/dates.js';
import { emit } from '../lib/events.js';
import { conflict, forbidden, notFound } from '../lib/errors.js';
import { newId } from '../lib/ids.js';
import { keys } from '../lib/keys.js';
import { hashOrNull, serializeTeam } from '../lib/serializers.js';
import { deleteTeam, getTeam, listMembers, loadTeam, reserveInviteCode } from '../lib/teams.js';
import { parse } from '../lib/validate.js';
import { authed, authUser, member, memberTeam } from '../plugins/auth.js';
import type { RouteOptions, Team, TeamHash } from '../types.js';

const nameSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
});

const joinSchema = z.object({
  inviteCode: z.string().trim().toUpperCase().min(1, 'Invite code is required').max(32),
});

const teamRoutes: FastifyPluginAsync<RouteOptions> = async (app) => {
  const redis = app.redis;

  app.get('/teams', { preHandler: authed }, async (request) => {
    const user = authUser(request);
    const ids = await redis.smembers(keys.userTeams(user.id));
    const pipe = redis.pipeline();
    for (const id of ids) {
      pipe.hgetall(keys.team(id));
      pipe.scard(keys.teamMembers(id));
    }
    const results = (await pipe.exec()) ?? [];
    const teams: Team[] = [];
    for (let i = 0; i < ids.length; i++) {
      const hashRes = results[i * 2];
      const countRes = results[i * 2 + 1];
      const team = hashOrNull<TeamHash>(hashRes?.[1] as Record<string, string>);
      if (team) teams.push(serializeTeam(team, Number(countRes?.[1] ?? 0)));
    }
    teams.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    return { teams };
  });

  app.post('/teams', { preHandler: authed }, async (request, reply) => {
    const user = authUser(request);
    const body = parse(nameSchema, request.body);
    const id = newId();
    const inviteCode = await reserveInviteCode(redis, id);
    const team: TeamHash = { id, name: body.name, ownerId: user.id, inviteCode, createdAt: nowIso() };
    await redis
      .multi()
      .hset(keys.team(id), team)
      .sadd(keys.teamMembers(id), user.id)
      .sadd(keys.userTeams(user.id), id)
      .exec();
    await emit(redis, id, ['team', 'activity'], { type: 'team.created', actorId: user.id, data: { name: team.name } });
    return reply.status(201).send({ team: serializeTeam(team, 1) });
  });

  app.post('/teams/join', { preHandler: authed }, async (request) => {
    const user = authUser(request);
    const body = parse(joinSchema, request.body);
    const teamId = await redis.get(keys.invite(body.inviteCode));
    const team = teamId ? await getTeam(redis, teamId) : null;
    if (!team) throw notFound('Invalid invite code');
    const added = await redis.sadd(keys.teamMembers(team.id), user.id);
    await redis.sadd(keys.userTeams(user.id), team.id);
    if (added === 1) {
      await emit(redis, team.id, ['members', 'team', 'activity'], {
        type: 'member.joined',
        actorId: user.id,
        data: { userId: user.id, name: user.name },
      });
    }
    return { team: await loadTeam(redis, team) };
  });

  app.get('/teams/:teamId', { preHandler: member }, async (request) => {
    const team = memberTeam(request);
    const [serialized, members] = await Promise.all([loadTeam(redis, team), listMembers(redis, team)]);
    return { team: serialized, members };
  });

  app.patch('/teams/:teamId', { preHandler: member }, async (request) => {
    const user = authUser(request);
    const team = memberTeam(request);
    if (team.ownerId !== user.id) throw forbidden('Only the team owner can rename the team');
    const body = parse(nameSchema, request.body);
    await redis.hset(keys.team(team.id), 'name', body.name);
    await emit(redis, team.id, ['team', 'activity'], {
      type: 'team.renamed',
      actorId: user.id,
      data: { from: team.name, to: body.name, name: body.name },
    });
    return { team: await loadTeam(redis, { ...team, name: body.name }) };
  });

  app.get('/teams/:teamId/members', { preHandler: member }, async (request) => {
    return { members: await listMembers(redis, memberTeam(request)) };
  });

  app.post('/teams/:teamId/invite', { preHandler: member }, async (request) => {
    const user = authUser(request);
    const team = memberTeam(request);
    if (team.ownerId !== user.id) throw forbidden('Only the team owner can regenerate the invite code');
    const inviteCode = await reserveInviteCode(redis, team.id);
    await redis.multi().hset(keys.team(team.id), 'inviteCode', inviteCode).del(keys.invite(team.inviteCode)).exec();
    await emit(redis, team.id, ['team']);
    return { team: await loadTeam(redis, { ...team, inviteCode }) };
  });

  app.delete('/teams/:teamId/members/me', { preHandler: member }, async (request, reply) => {
    const user = authUser(request);
    const team = memberTeam(request);
    const count = await redis.scard(keys.teamMembers(team.id));
    if (team.ownerId === user.id && count > 1) {
      throw conflict('The owner cannot leave while other members remain');
    }
    await redis.multi().srem(keys.teamMembers(team.id), user.id).srem(keys.userTeams(user.id), team.id).exec();
    const remaining = await redis.scard(keys.teamMembers(team.id));
    if (remaining === 0) {
      await deleteTeam(redis, team);
      await emit(redis, team.id, ['members', 'team']);
    } else {
      await emit(redis, team.id, ['members', 'team', 'activity'], {
        type: 'member.left',
        actorId: user.id,
        data: { userId: user.id, name: user.name },
      });
    }
    return reply.status(204).send();
  });
};

export default teamRoutes;
