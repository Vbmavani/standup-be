import type { TaskStatus } from '../types.js';

/** Redis key names — must match the table in docs/PLAN.md. */
export const keys = {
  user: (id: string) => `user:${id}`,
  userEmail: (email: string) => `user:email:${email}`,
  session: (token: string) => `session:${token}`,
  userTeams: (id: string) => `user:${id}:teams`,
  team: (id: string) => `team:${id}`,
  teamMembers: (id: string) => `team:${id}:members`,
  invite: (code: string) => `invite:${code}`,
  task: (id: string) => `task:${id}`,
  column: (teamId: string, status: TaskStatus) => `team:${teamId}:col:${status}`,
  standup: (teamId: string, date: string) => `standup:${teamId}:${date}`,
  activity: (teamId: string) => `team:${teamId}:activity`,
  events: (teamId: string) => `team:${teamId}:events`,
};

export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
