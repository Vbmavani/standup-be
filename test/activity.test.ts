import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, createTeam, createTestApp, joinTeam, signup } from './helpers.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = await createTestApp();
});
afterAll(async () => {
  await app.close();
});

describe('activity', () => {
  it('returns items newest first with actor names, honouring limit', async () => {
    const owner = await signup(app, { name: 'Alice' });
    const bob = await signup(app, { name: 'Bob' });
    const team = await createTeam(app, owner.cookie, 'Squad');
    await joinTeam(app, bob.cookie, team.inviteCode);
    const task = (await as(app, bob.cookie).post(`/api/teams/${team.id}/tasks`, { title: 'T1' })).json().task;
    await as(app, owner.cookie).post(`/api/teams/${team.id}/tasks/${task.id}/move`, { status: 'done', index: 0 });
    await as(app, owner.cookie).put(`/api/teams/${team.id}/standups/me`, { date: '2026-10-16', today: 'x' });
    await as(app, owner.cookie).patch(`/api/teams/${team.id}`, { name: 'Squad 2' });

    const res = await as(app, bob.cookie).get(`/api/teams/${team.id}/activity`);
    expect(res.statusCode).toBe(200);
    const items = res.json().items as {
      type: string;
      actorName: string;
      actorId: string;
      data: Record<string, unknown>;
    }[];
    expect(items.map((i) => i.type)).toEqual([
      'team.renamed',
      'standup.submitted',
      'task.moved',
      'task.created',
      'member.joined',
      'team.created',
    ]);
    expect(items[0]).toMatchObject({ actorId: owner.user.id, actorName: 'Alice', data: { name: 'Squad 2' } });
    expect(items[1]!.data).toEqual({ date: '2026-10-16' });
    expect(items[2]!.data).toMatchObject({ taskId: task.id, title: 'T1', from: 'todo', to: 'done' });
    expect(items[3]!.actorName).toBe('Bob');
    expect(items[0]).toEqual({
      id: expect.stringMatching(/^\d+-\d+$/),
      type: 'team.renamed',
      actorId: owner.user.id,
      actorName: 'Alice',
      createdAt: expect.any(String),
      data: expect.any(Object),
    });

    const limited = await as(app, bob.cookie).get(`/api/teams/${team.id}/activity?limit=2`);
    expect(limited.json().items).toHaveLength(2);
    expect((await as(app, bob.cookie).get(`/api/teams/${team.id}/activity?limit=0`)).statusCode).toBe(400);
    expect((await as(app, bob.cookie).get(`/api/teams/${team.id}/activity?limit=201`)).statusCode).toBe(400);
  });
});
