import type { FastifyInstance } from 'fastify';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, createTeam, createTestApp, signup } from './helpers.js';

let app: FastifyInstance;
let port: number;
beforeAll(async () => {
  app = await createTestApp();
  await app.listen({ port: 0, host: '127.0.0.1' });
  port = (app.server.address() as AddressInfo).port;
});
afterAll(async () => {
  await app.close();
});

describe('live events (SSE)', () => {
  it('streams published events to members and cleans up on disconnect', async () => {
    const { cookie } = await signup(app);
    const team = await createTeam(app, cookie);

    const received: string[] = [];
    let headers: http.IncomingHttpHeaders = {};
    const req = http.get(
      { host: '127.0.0.1', port, path: `/api/teams/${team.id}/events`, headers: { cookie, origin: 'http://localhost:5173' } },
      (res) => {
        headers = res.headers;
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => received.push(chunk));
      },
    );
    req.on('error', () => {});

    const waitFor = async (pred: () => boolean) => {
      for (let i = 0; i < 100 && !pred(); i++) await new Promise((r) => setTimeout(r, 20));
      expect(pred()).toBe(true);
    };

    await waitFor(() => received.join('').includes(': connected'));
    expect(headers['content-type']).toContain('text/event-stream');
    expect(headers['cache-control']).toBe('no-cache');
    expect(headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(headers['access-control-allow-credentials']).toBe('true');
    expect(app.sseClients.size).toBe(1);

    await as(app, cookie).post(`/api/teams/${team.id}/tasks`, { title: 'Live' });
    await waitFor(() => received.join('').includes('data: {"type":"activity"}'));
    const text = received.join('');
    expect(text).toContain('data: {"type":"tasks"}\n\n');

    req.destroy();
    await waitFor(() => app.sseClients.size === 0);
  });
});
