import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { as, createTeam, createTestApp, joinTeam, signup } from './helpers.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = await createTestApp();
});
beforeEach(async () => {
  await app.redis.flushdb();
});
afterAll(async () => {
  await app.close();
});

describe('teams', () => {
  it('creates a team with the creator as owner and member', async () => {
    const { cookie, user } = await signup(app);
    const res = await as(app, cookie).post('/api/teams', { name: 'Platform' });
    expect(res.statusCode).toBe(201);
    const { team } = res.json();
    expect(team).toEqual({
      id: expect.any(String),
      name: 'Platform',
      ownerId: user.id,
      inviteCode: expect.stringMatching(/^[A-Z0-9]{8}$/),
      createdAt: expect.any(String),
      memberCount: 1,
    });
    const detail = await as(app, cookie).get(`/api/teams/${team.id}`);
    expect(detail.statusCode).toBe(200);
    expect(detail.json().members).toEqual([{ id: user.id, name: user.name, email: user.email, isOwner: true }]);
  });

  it('lists my teams sorted by name', async () => {
    const { cookie } = await signup(app);
    await createTeam(app, cookie, 'zeta');
    await createTeam(app, cookie, 'Alpha');
    await createTeam(app, cookie, 'beta');
    const res = await as(app, cookie).get('/api/teams');
    expect(res.json().teams.map((t: { name: string }) => t.name)).toEqual(['Alpha', 'beta', 'zeta']);
  });

  it('joins with an invite code (case-insensitive, idempotent) and 404s on bad codes', async () => {
    const owner = await signup(app);
    const bob = await signup(app, { name: 'Bob' });
    const team = await createTeam(app, owner.cookie);

    const bad = await as(app, bob.cookie).post('/api/teams/join', { inviteCode: 'NOPE1234' });
    expect(bad.statusCode).toBe(404);
    expect(bad.json().error.code).toBe('NOT_FOUND');

    const joined = await as(app, bob.cookie).post('/api/teams/join', { inviteCode: team.inviteCode.toLowerCase() });
    expect(joined.statusCode).toBe(200);
    expect(joined.json().team.memberCount).toBe(2);
    const again = await as(app, bob.cookie).post('/api/teams/join', { inviteCode: team.inviteCode });
    expect(again.statusCode).toBe(200);
    expect(again.json().team.memberCount).toBe(2);

    const members = await as(app, bob.cookie).get(`/api/teams/${team.id}/members`);
    expect(members.statusCode).toBe(200);
    expect(members.json().members).toHaveLength(2);
    expect(members.json().members.find((m: { id: string }) => m.id === bob.user.id).isOwner).toBe(false);
    expect((await as(app, bob.cookie).get('/api/teams')).json().teams).toHaveLength(1);
  });

  it('only the owner can rename; others get 403', async () => {
    const owner = await signup(app);
    const bob = await signup(app);
    const team = await createTeam(app, owner.cookie, 'Old');
    await joinTeam(app, bob.cookie, team.inviteCode);

    const denied = await as(app, bob.cookie).patch(`/api/teams/${team.id}`, { name: 'Hacked' });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe('FORBIDDEN');

    const ok = await as(app, owner.cookie).patch(`/api/teams/${team.id}`, { name: 'New' });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().team.name).toBe('New');
    expect(ok.json().team.memberCount).toBe(2);
  });

  it('regenerates the invite code (owner only) and invalidates the old one', async () => {
    const owner = await signup(app);
    const bob = await signup(app);
    const carol = await signup(app);
    const team = await createTeam(app, owner.cookie);
    await joinTeam(app, bob.cookie, team.inviteCode);

    expect((await as(app, bob.cookie).post(`/api/teams/${team.id}/invite`)).statusCode).toBe(403);
    const res = await as(app, owner.cookie).post(`/api/teams/${team.id}/invite`);
    expect(res.statusCode).toBe(200);
    const newCode = res.json().team.inviteCode;
    expect(newCode).toMatch(/^[A-Z0-9]{8}$/);
    expect(newCode).not.toBe(team.inviteCode);

    expect((await as(app, carol.cookie).post('/api/teams/join', { inviteCode: team.inviteCode })).statusCode).toBe(404);
    expect((await as(app, carol.cookie).post('/api/teams/join', { inviteCode: newCode })).statusCode).toBe(200);
  });

  it('non-members get 403 and unknown teams 404', async () => {
    const owner = await signup(app);
    const stranger = await signup(app);
    const team = await createTeam(app, owner.cookie);
    for (const url of [
      `/api/teams/${team.id}`,
      `/api/teams/${team.id}/members`,
      `/api/teams/${team.id}/tasks`,
      `/api/teams/${team.id}/standups`,
      `/api/teams/${team.id}/activity`,
      `/api/teams/${team.id}/summary`,
      `/api/teams/${team.id}/events`,
    ]) {
      const res = await as(app, stranger.cookie).get(url);
      expect(res.statusCode, url).toBe(403);
      expect(res.json().error.code).toBe('FORBIDDEN');
    }
    const missing = await as(app, owner.cookie).get('/api/teams/does-not-exist');
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe('NOT_FOUND');
  });

  it('leave rules: owner 409 while others remain; member leaves; last member deletes the team', async () => {
    const owner = await signup(app);
    const bob = await signup(app);
    const team = await createTeam(app, owner.cookie);
    await joinTeam(app, bob.cookie, team.inviteCode);
    await as(app, owner.cookie).post(`/api/teams/${team.id}/tasks`, { title: 'A task' });
    await as(app, owner.cookie).put(`/api/teams/${team.id}/standups/me`, { date: '2026-01-05', today: 'stuff' });

    const blocked = await as(app, owner.cookie).delete(`/api/teams/${team.id}/members/me`);
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error.code).toBe('CONFLICT');

    const left = await as(app, bob.cookie).delete(`/api/teams/${team.id}/members/me`);
    expect(left.statusCode).toBe(204);
    expect((await as(app, bob.cookie).get(`/api/teams/${team.id}`)).statusCode).toBe(403);
    expect((await as(app, bob.cookie).get('/api/teams')).json().teams).toEqual([]);

    const ownerLeaves = await as(app, owner.cookie).delete(`/api/teams/${team.id}/members/me`);
    expect(ownerLeaves.statusCode).toBe(204);
    expect((await as(app, owner.cookie).get(`/api/teams/${team.id}`)).statusCode).toBe(404);
    expect((await as(app, owner.cookie).get('/api/teams')).json().teams).toEqual([]);

    const leftovers = (await app.redis.keys('*')).filter(
      (k) => k.includes(team.id) || k.startsWith('task:') || k.startsWith('invite:'),
    );
    expect(leftovers).toEqual([]);
  });

  it('validates team names', async () => {
    const { cookie } = await signup(app);
    const res = await as(app, cookie).post('/api/teams', { name: '   ' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });
});
