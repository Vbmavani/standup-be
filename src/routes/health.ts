import type { FastifyPluginAsync } from 'fastify';
import type { RouteOptions } from '../types.js';

const healthRoutes: FastifyPluginAsync<RouteOptions> = async (app) => {
  app.get('/health', async (_request, reply) => {
    try {
      await app.redis.ping();
      return { ok: true, redis: 'up' };
    } catch {
      return reply.status(503).send({ ok: false, redis: 'down' });
    }
  });
};

export default healthRoutes;
