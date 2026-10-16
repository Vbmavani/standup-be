import type { FastifyPluginAsync } from 'fastify';
import { keys } from '../lib/keys.js';
import { createSubscriber } from '../redis.js';
import { member, memberTeam } from '../plugins/auth.js';
import type { RouteOptions } from '../types.js';

const PING_INTERVAL_MS = 25_000;

const eventsRoutes: FastifyPluginAsync<RouteOptions> = async (app, opts) => {
  app.get('/teams/:teamId/events', { preHandler: member }, async (request, reply) => {
    const team = memberTeam(request);
    const channel = keys.events(team.id);

    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': opts.webOrigin,
      'Access-Control-Allow-Credentials': 'true',
      Vary: 'Origin',
    });
    res.write(': connected\n\n');

    const sub = createSubscriber(app.redis);
    sub.on('error', (err) => request.log.warn({ err }, 'SSE subscriber error'));
    sub.on('message', (ch: string, message: string) => {
      if (ch === channel && !res.writableEnded) res.write(`data: ${message}\n\n`);
    });
    const ping = setInterval(() => {
      if (!res.writableEnded) res.write(': ping\n\n');
    }, PING_INTERVAL_MS);

    let closed = false;
    const cleanup = () => {
      if (closed) return;
      closed = true;
      clearInterval(ping);
      app.sseClients.delete(cleanup);
      sub.quit().catch(() => sub.disconnect());
      if (!res.writableEnded) res.end();
    };
    app.sseClients.add(cleanup);
    // The response's 'close' fires when the client disconnects (IncomingMessage 'close'
    // can fire as soon as a GET's empty body is consumed, so it isn't reliable here).
    res.on('close', cleanup);
    request.raw.socket?.once('close', cleanup);

    try {
      await sub.subscribe(channel);
    } catch (err) {
      request.log.error({ err }, 'SSE subscribe failed');
      cleanup();
    }
  });
};

export default eventsRoutes;
