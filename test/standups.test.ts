import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { as, createTeam, createTestApp, joinTeam, signup, type TestUser } from './helpers.js';

let app: FastifyInstance;
let owner: TestUser;
let bob: TestUser;
let teamId: string;

beforeAll(async () => {
  app = await createTestApp();
});
beforeEach(async () => {
  await app.redis.flushdb();
  owner = await signup(app, { name: 'Alice' });
  bob = await signup(app, { name: 'Bob' });
  const team = await createTeam(app, owner.cookie);
  teamId = team.id;
  await joinTeam(app, bob.cookie, team.inviteCode);
});
afterAll(async () => {
  await app.close();
});

describe('standups', () => {
  it('upserts my entry and lists entries plus missing members', async () => {
    const url = `/api/teams/${teamId}/standups`;
    const put = await as(app, owner.cookie).put(`${url}/me`, {
      date: '2026-10-15',
      yesterday: 'Planning',
      today: 'Build API',
      blockers: '',
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().entry).toEqual({
      userId: owner.user.id,
      userName: 'Alice',
      date: '2026-10-15',
      yesterday: 'Planning',
      today: 'Build API',
      blockers: '',
      updatedAt: expect.any(String),
    });

    const edit = await as(app, owner.cookie).put(`${url}/me`, {
      date: '2026-10-15',
      yesterday: '',
      today: 'Edited',
      blockers: 'CI',
    });
    expect(edit.statusCode).toBe(200);

    const res = await as(app, bob.cookie).get(`${url}?date=2026-10-15`);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.date).toBe('2026-10-15');
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0]).toMatchObject({
      userId: owner.user.id,
      userName: 'Alice',
      today: 'Edited',
      blockers: 'CI',
    });
    expect(body.missing).toEqual([{ id: bob.user.id, name: 'Bob', email: bob.user.email, isOwner: false }]);

    const other = await as(app, bob.cookie).get(`${url}?date=2026-10-14`);
    expect(other.json().entries).toEqual([]);
    expect(other.json().missing).toHaveLength(2);
  });

  it('defaults the date to today (UTC)', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const put = await as(app, bob.cookie).put(`/api/teams/${teamId}/standups/me`, { today: 'Something' });
    expect(put.json().entry.date).toBe(today);
    const res = await as(app, bob.cookie).get(`/api/teams/${teamId}/standups`);
    expect(res.json().date).toBe(today);
    expect(res.json().entries.map((e: { userId: string }) => e.userId)).toEqual([bob.user.id]);
  });

  it('validates date format and fields', async () => {
    const url = `/api/teams/${teamId}/standups`;
    const api = as(app, owner.cookie);
    expect((await api.get(`${url}?date=15-10-2026`)).statusCode).toBe(400);
    expect((await api.get(`${url}?date=2026-02-30`)).statusCode).toBe(400);
    expect((await api.put(`${url}/me`, { today: '' })).statusCode).toBe(400);
    expect((await api.put(`${url}/me`, { yesterday: 'x' })).statusCode).toBe(400);
    expect((await api.put(`${url}/me`, { today: 'x'.repeat(2001) })).statusCode).toBe(400);
    expect((await api.put(`${url}/me`, { today: 'ok', date: '2026/10/15' })).statusCode).toBe(400);
  });
});
