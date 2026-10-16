import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, cookieFrom, createTestApp, signup } from './helpers.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = await createTestApp();
});
afterAll(async () => {
  await app.close();
});

describe('auth', () => {
  it('signs up, sets an httpOnly sid cookie and never returns the password hash', async () => {
    const res = await as(app).post('/api/auth/signup', { name: 'Ada', email: 'Ada@Example.com', password: 'password123' });
    expect(res.statusCode).toBe(201);
    const { user } = res.json();
    expect(user).toEqual({ id: expect.any(String), name: 'Ada', email: 'ada@example.com', createdAt: expect.any(String) });
    expect(user.passwordHash).toBeUndefined();
    const sid = res.cookies.find((c) => c.name === 'sid');
    expect(sid?.value).toMatch(/^[0-9a-f]{64}$/);
    expect(sid?.httpOnly).toBe(true);
    expect(sid?.sameSite).toBe('Lax');
    expect(sid?.path).toBe('/');
    expect(sid?.maxAge).toBe(7 * 24 * 60 * 60);
    expect(await app.redis.ttl(`session:${sid?.value}`)).toBeGreaterThan(7 * 24 * 60 * 60 - 10);
  });

  it('rejects a duplicate email with 409', async () => {
    await signup(app, { email: 'dup@example.com' });
    const res = await as(app).post('/api/auth/signup', { name: 'X', email: 'DUP@example.com', password: 'password123' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('CONFLICT');
  });

  it('validates signup input', async () => {
    const res = await as(app).post('/api/auth/signup', { name: 'X', email: 'not-an-email', password: 'short' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
    expect(res.json().error.message).toMatch(/email/);
  });

  it('signs in with correct credentials and rejects wrong ones with 401', async () => {
    await signup(app, { email: 'bob@example.com', password: 'correct-horse' });
    const bad = await as(app).post('/api/auth/signin', { email: 'bob@example.com', password: 'wrong-password' });
    expect(bad.statusCode).toBe(401);
    expect(bad.json().error.code).toBe('UNAUTHORIZED');
    const unknown = await as(app).post('/api/auth/signin', { email: 'nobody@example.com', password: 'whatever1' });
    expect(unknown.statusCode).toBe(401);

    const ok = await as(app).post('/api/auth/signin', { email: 'BOB@example.com', password: 'correct-horse' });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().user.email).toBe('bob@example.com');
    const me = await as(app, cookieFrom(ok.cookies)).get('/api/auth/me');
    expect(me.statusCode).toBe(200);
    expect(me.json().user.email).toBe('bob@example.com');
  });

  it('GET /auth/me returns 401 without a session', async () => {
    const res = await as(app).get('/api/auth/me');
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: { code: 'UNAUTHORIZED', message: expect.any(String) } });
    const bogus = await as(app, 'sid=deadbeef').get('/api/auth/me');
    expect(bogus.statusCode).toBe(401);
  });

  it('signs out: 204, clears the cookie and the session', async () => {
    const { cookie } = await signup(app);
    const res = await as(app, cookie).post('/api/auth/signout');
    expect(res.statusCode).toBe(204);
    const cleared = res.cookies.find((c) => c.name === 'sid');
    expect(cleared?.value).toBe('');
    expect((await as(app, cookie).get('/api/auth/me')).statusCode).toBe(401);
  });

  it('protected routes require a session', async () => {
    for (const [method, url] of [
      ['GET', '/api/teams'],
      ['POST', '/api/teams'],
      ['PATCH', '/api/users/me'],
      ['GET', '/api/teams/x/tasks'],
      ['GET', '/api/teams/x/events'],
    ] as const) {
      const res = await app.inject({ method, url, payload: method === 'GET' ? undefined : {} });
      expect(res.statusCode, `${method} ${url}`).toBe(401);
    }
  });
});

describe('users', () => {
  it('PATCH /users/me updates the display name', async () => {
    const { cookie } = await signup(app, { name: 'Old' });
    const res = await as(app, cookie).patch('/api/users/me', { name: '  New Name ' });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.name).toBe('New Name');
    expect((await as(app, cookie).get('/api/auth/me')).json().user.name).toBe('New Name');
    expect((await as(app, cookie).patch('/api/users/me', { name: '' })).statusCode).toBe(400);
  });
});
