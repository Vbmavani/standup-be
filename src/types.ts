import type { Redis } from 'ioredis';

export type TaskStatus = 'todo' | 'in_progress' | 'done';
export const TASK_STATUSES: readonly TaskStatus[] = ['todo', 'in_progress', 'done'];

export type ActivityType =
  | 'team.created'
  | 'team.renamed'
  | 'member.joined'
  | 'member.left'
  | 'task.created'
  | 'task.updated'
  | 'task.moved'
  | 'task.deleted'
  | 'standup.submitted';

export type EventType = 'tasks' | 'standups' | 'activity' | 'team' | 'members';

/** Raw hash shapes as stored in Redis. */
export type UserHash = { id: string; name: string; email: string; passwordHash: string; createdAt: string };
export type TeamHash = { id: string; name: string; ownerId: string; inviteCode: string; createdAt: string };
export type TaskHash = {
  id: string;
  teamId: string;
  title: string;
  description: string;
  status: TaskStatus;
  assigneeId: string;
  dueDate: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string;
};

/** JSON shapes from docs/PLAN.md. */
export type User = { id: string; name: string; email: string; createdAt: string };
export type Team = {
  id: string;
  name: string;
  ownerId: string;
  inviteCode: string;
  createdAt: string;
  memberCount: number;
};
export type Member = { id: string; name: string; email: string; isOwner: boolean };
export type Task = {
  id: string;
  teamId: string;
  title: string;
  description: string;
  status: TaskStatus;
  assigneeId: string | null;
  dueDate: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};
export type StandupEntry = {
  userId: string;
  userName: string;
  date: string;
  yesterday: string;
  today: string;
  blockers: string;
  updatedAt: string;
};
export type StoredStandup = { yesterday: string; today: string; blockers: string; updatedAt: string };
export type ActivityItem = {
  id: string;
  type: ActivityType;
  actorId: string;
  actorName: string;
  createdAt: string;
  data: Record<string, unknown>;
};

declare module 'fastify' {
  interface FastifyInstance {
    redis: Redis;
    sseClients: Set<() => void>;
  }
  interface FastifyRequest {
    user: UserHash | null;
    sessionToken: string | null;
    team: TeamHash | null;
  }
}

/** Options passed to every route plugin by buildApp(). */
export type RouteOptions = { cookieSecure: boolean; webOrigin: string };
