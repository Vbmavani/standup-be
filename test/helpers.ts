import type { FastifyInstance, InjectOptions } from 'fastify';
import { buildApp } from '../src/app.js';

export const TEST_REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379/15';

/** Build an app on Redis DB 15 and wipe it. */
export async function createTestApp(): Promise<FastifyInstance> {
  const app = await buildApp({ redisUrl: TEST_REDIS_URL });
  await app.ready();
  await app.redis.flushdb();
  return app;
}

let counter = 0;

export type TestUser = { cookie: string; user: { id: string; name: string; email: string; createdAt: string } };

/** Sign up a fresh user and return their session cookie header (`sid=...`). */
export async function signup(
  app: FastifyInstance,
  overrides: Partial<{ name: string; email: string; password: string }> = {},
): Promise<TestUser> {
  counter++;
  const body = {
    name: overrides.name ?? `User ${counter}`,
    email: overrides.email ?? `user${counter}-${Date.now()}@example.com`,
    password: overrides.password ?? 'password123',
  };
  const res = await app.inject({ method: 'POST', url: '/api/auth/signup', payload: body });
  if (res.statusCode !== 201) throw new Error(`signup failed: ${res.statusCode} ${res.body}`);
  return { cookie: cookieFrom(res.cookies), user: res.json().user };
}

export function cookieFrom(cookies: { name: string; value: string }[]): string {
  const sid = cookies.find((c) => c.name === 'sid');
  if (!sid) throw new Error('no sid cookie set');
  return `sid=${sid.value}`;
}

/** Inject a request as the given user (cookie may be undefined for anonymous). */
export function as(app: FastifyInstance, cookie?: string) {
  const send = (method: InjectOptions['method'], url: string, payload?: unknown) =>
    app.inject({
      method,
      url,
      headers: cookie ? { cookie } : {},
      ...(payload === undefined ? {} : { payload: payload as InjectOptions['payload'] }),
    });
  return {
    get: (url: string) => send('GET', url),
    post: (url: string, payload?: unknown) => send('POST', url, payload),
    put: (url: string, payload?: unknown) => send('PUT', url, payload),
    patch: (url: string, payload?: unknown) => send('PATCH', url, payload),
    delete: (url: string) => send('DELETE', url),
  };
}

/** Create a team owned by `owner` and return it. */
export async function createTeam(app: FastifyInstance, cookie: string, name = 'Team') {
  const res = await as(app, cookie).post('/api/teams', { name });
  if (res.statusCode !== 201) throw new Error(`createTeam failed: ${res.statusCode} ${res.body}`);
  return res.json().team as { id: string; name: string; ownerId: string; inviteCode: string; memberCount: number };
}

export async function joinTeam(app: FastifyInstance, cookie: string, inviteCode: string) {
  const res = await as(app, cookie).post('/api/teams/join', { inviteCode });
  if (res.statusCode !== 200) throw new Error(`joinTeam failed: ${res.statusCode} ${res.body}`);
  return res.json().team;
}
