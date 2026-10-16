import type { FastifyRequest } from 'fastify';
import { forbidden, notFound, unauthorized } from '../lib/errors.js';
import { keys, SESSION_TTL_SECONDS } from '../lib/keys.js';
import { getTeam } from '../lib/teams.js';
import { getUser } from '../lib/users.js';
import type { TeamHash, UserHash } from '../types.js';

export const SESSION_COOKIE = 'sid';

export function sessionCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    path: '/',
    secure,
    maxAge: SESSION_TTL_SECONDS, // seconds
  };
}

/** preHandler: resolve the `sid` cookie to a user, or 401. */
export async function requireAuth(request: FastifyRequest): Promise<void> {
  const token = request.cookies[SESSION_COOKIE];
  if (!token) throw unauthorized();
  const redis = request.server.redis;
  const userId = await redis.get(keys.session(token));
  if (!userId) throw unauthorized('Session expired');
  const user = await getUser(redis, userId);
  if (!user) throw unauthorized('Session expired');
  request.user = user;
  request.sessionToken = token;
}

/** preHandler (after requireAuth): the team must exist (404) and the user must be a member (403). */
export async function requireMember(request: FastifyRequest): Promise<void> {
  const { teamId } = request.params as { teamId?: string };
  if (!teamId) throw notFound('Team not found');
  const redis = request.server.redis;
  const team = await getTeam(redis, teamId);
  if (!team) throw notFound('Team not found');
  const user = authUser(request);
  const isMember = await redis.sismember(keys.teamMembers(teamId), user.id);
  if (!isMember) throw forbidden('You are not a member of this team');
  request.team = team;
}

export const authed = [requireAuth];
export const member = [requireAuth, requireMember];

export function authUser(request: FastifyRequest): UserHash {
  if (!request.user) throw unauthorized();
  return request.user;
}

export function memberTeam(request: FastifyRequest): TeamHash {
  if (!request.team) throw notFound('Team not found');
  return request.team;
}

