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

describe('summary', () => {
  it('counts tasks, standups and blockers for the week', async () => {
    const alice = await signup(app, { name: 'Alice' });
    const bob = await signup(app, { name: 'Bob' });
    const team = await createTeam(app, alice.cookie);
    await joinTeam(app, bob.cookie, team.inviteCode);
    const tasks = `/api/teams/${team.id}/tasks`;

    // Alice creates 3 tasks (one assigned to Bob), Bob creates 1.
    const t1 = (await as(app, alice.cookie).post(tasks, { title: 'T1', assigneeId: bob.user.id })).json().task;
    const t2 = (await as(app, alice.cookie).post(tasks, { title: 'T2' })).json().task;
    await as(app, alice.cookie).post(tasks, { title: 'T3' });
    await as(app, bob.cookie).post(tasks, { title: 'T4' });
    // T1 completed → credited to Bob (assignee); T2 completed → credited to Alice (creator).
    await as(app, alice.cookie).post(`${tasks}/${t1.id}/move`, { status: 'done', index: 0 });
    await as(app, bob.cookie).post(`${tasks}/${t2.id}/move`, { status: 'done', index: 0 });

    // An old task that falls outside the week.
    const oldId = 'old-task';
    await app.redis.hset(`task:${oldId}`, {
      id: oldId, teamId: team.id, title: 'Old', description: '', status: 'done', assigneeId: '', dueDate: '',
      createdBy: alice.user.id, createdAt: '2020-01-01T00:00:00.000Z', updatedAt: '2020-01-01T00:00:00.000Z',
      completedAt: '2020-01-02T00:00:00.000Z',
    });
    await app.redis.rpush(`team:${team.id}:col:done`, oldId);

    const today = new Date().toISOString().slice(0, 10);
    const d = new Date(`${today}T00:00:00Z`);
    const dow = d.getUTCDay();
    d.setUTCDate(d.getUTCDate() + (dow === 0 ? -6 : 1 - dow));
    const monday = d.toISOString().slice(0, 10);
    const plus = (n: number) => {
      const x = new Date(`${monday}T00:00:00Z`);
      x.setUTCDate(x.getUTCDate() + n);
      return x.toISOString().slice(0, 10);
    };

    const standups = `/api/teams/${team.id}/standups/me`;
    await as(app, alice.cookie).put(standups, { date: plus(0), today: 'a', blockers: 'Waiting on review' });
    await as(app, alice.cookie).put(standups, { date: plus(1), today: 'b', blockers: '  ' });
    await as(app, bob.cookie).put(standups, { date: plus(0), today: 'c', blockers: 'VPN down' });
    await as(app, bob.cookie).put(standups, { date: plus(7), today: 'next week', blockers: 'ignored' });

    const res = await as(app, alice.cookie).get(`/api/teams/${team.id}/summary?weekStart=${monday}`);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.weekStart).toBe(monday);
    expect(body.weekEnd).toBe(plus(6));
    expect(body.totals).toEqual({ tasksCreated: 4, tasksCompleted: 2, standupsSubmitted: 3, blockers: 2 });
    expect(body.members).toEqual([
      { userId: alice.user.id, name: 'Alice', standupsSubmitted: 2, tasksCreated: 3, tasksCompleted: 1 },
      { userId: bob.user.id, name: 'Bob', standupsSubmitted: 1, tasksCreated: 1, tasksCompleted: 1 },
    ]);
    expect(body.blockers).toEqual([
      { userId: alice.user.id, name: 'Alice', date: plus(0), text: 'Waiting on review' },
      { userId: bob.user.id, name: 'Bob', date: plus(0), text: 'VPN down' },
    ]);

    // default weekStart is the current Monday
    const def = await as(app, alice.cookie).get(`/api/teams/${team.id}/summary`);
    expect(def.json().weekStart).toBe(monday);

    const prev = await as(app, alice.cookie).get(`/api/teams/${team.id}/summary?weekStart=${plus(-7)}`);
    expect(prev.json().totals).toEqual({ tasksCreated: 0, tasksCompleted: 0, standupsSubmitted: 0, blockers: 0 });

    expect((await as(app, alice.cookie).get(`/api/teams/${team.id}/summary?weekStart=bad`)).statusCode).toBe(400);
  });
});
