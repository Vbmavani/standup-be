import type { Member, Task, TaskHash, Team, TeamHash, User, UserHash } from '../types.js';

const orNull = (v: string | undefined): string | null => (v ? v : null);

export function serializeUser(u: UserHash): User {
  return { id: u.id, name: u.name, email: u.email, createdAt: u.createdAt };
}

export function serializeTeam(t: TeamHash, memberCount: number): Team {
  return {
    id: t.id,
    name: t.name,
    ownerId: t.ownerId,
    inviteCode: t.inviteCode,
    createdAt: t.createdAt,
    memberCount,
  };
}

export function serializeMember(u: UserHash, ownerId: string): Member {
  return { id: u.id, name: u.name, email: u.email, isOwner: u.id === ownerId };
}

export function serializeTask(t: TaskHash): Task {
  return {
    id: t.id,
    teamId: t.teamId,
    title: t.title,
    description: t.description ?? '',
    status: t.status,
    assigneeId: orNull(t.assigneeId),
    dueDate: orNull(t.dueDate),
    createdBy: t.createdBy,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    completedAt: orNull(t.completedAt),
  };
}

/** HGETALL returns {} for a missing key; treat that as null. */
export function hashOrNull<T>(h: Record<string, string> | null | undefined): T | null {
  if (!h || Object.keys(h).length === 0) return null;
  return h as unknown as T;
}
