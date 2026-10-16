import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, createTestApp } from './helpers.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = await createTestApp();
});
afterAll(async () => {
  await app.close();
});

describe('health & errors', () => {
  it('GET /api/health reports redis up', async () => {
    const res = await as(app).get('/api/health');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, redis: 'up' });
  });

  it('unknown routes return the ApiError shape', async () => {
    const res = await as(app).get('/api/nope');
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });

  it('malformed JSON bodies are 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/signin',
      headers: { 'content-type': 'application/json' },
      payload: '{"email":',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('CORS allows the web origin with credentials', async () => {
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/api/teams',
      headers: {
        origin: 'http://localhost:5173',
        'access-control-request-method': 'PATCH',
      },
    });
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
    expect(String(res.headers['access-control-allow-methods'])).toContain('PATCH');
  });
});
