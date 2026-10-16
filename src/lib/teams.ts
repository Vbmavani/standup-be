import type { Redis } from 'ioredis';
import { TASK_STATUSES, type Member, type Team, type TeamHash } from '../types.js';
import { conflict } from './errors.js';
import { newInviteCode } from './ids.js';
import { keys } from './keys.js';
import { hashOrNull, serializeMember, serializeTeam } from './serializers.js';
import { getUsers } from './users.js';

export async function getTeam(redis: Redis, id: string): Promise<TeamHash | null> {
  return hashOrNull<TeamHash>(await redis.hgetall(keys.team(id)));
}

export async function loadTeam(redis: Redis, team: TeamHash): Promise<Team> {
  const count = await redis.scard(keys.teamMembers(team.id));
  return serializeTeam(team, count);
}

/** Members sorted with the owner first, then by name. */
export async function listMembers(redis: Redis, team: TeamHash): Promise<Member[]> {
  const ids = await redis.smembers(keys.teamMembers(team.id));
  const users = await getUsers(redis, ids);
  return [...users.values()]
    .map((u) => serializeMember(u, team.ownerId))
    .sort((a, b) =>
      a.isOwner !== b.isOwner ? (a.isOwner ? -1 : 1) : a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
    );
}

/** Reserve a fresh, unused invite code pointing at `teamId`. */
export async function reserveInviteCode(redis: Redis, teamId: string): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = newInviteCode();
    const ok = await redis.set(keys.invite(code), teamId, 'NX');
    if (ok === 'OK') return code;
  }
  throw conflict('Could not generate a unique invite code');
}

/** Remove a team and everything that hangs off it. */
export async function deleteTeam(redis: Redis, team: TeamHash): Promise<void> {
  const taskIds: string[] = [];
  for (const status of TASK_STATUSES) taskIds.push(...(await redis.lrange(keys.column(team.id, status), 0, -1)));

  const standupKeys: string[] = [];
  let cursor = '0';
  do {
    const [next, batch] = await redis.scan(cursor, 'MATCH', keys.standup(team.id, '*'), 'COUNT', 200);
    cursor = next;
    standupKeys.push(...batch);
  } while (cursor !== '0');

  const memberIds = await redis.smembers(keys.teamMembers(team.id));

  const multi = redis.multi();
  for (const id of taskIds) multi.del(keys.task(id));
  for (const status of TASK_STATUSES) multi.del(keys.column(team.id, status));
  for (const k of standupKeys) multi.del(k);
  for (const uid of memberIds) multi.srem(keys.userTeams(uid), team.id);
  multi.del(keys.team(team.id), keys.teamMembers(team.id), keys.invite(team.inviteCode), keys.activity(team.id));
  await multi.exec();
}
