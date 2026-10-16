import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { loadConfig } from './config.js';
import { AppError, badRequest, codeForStatus } from './lib/errors.js';
import { createRedis } from './redis.js';
import activityRoutes from './routes/activity.js';
import authRoutes from './routes/auth.js';
import eventsRoutes from './routes/events.js';
import healthRoutes from './routes/health.js';
import standupRoutes from './routes/standups.js';
import summaryRoutes from './routes/summary.js';
import taskRoutes from './routes/tasks.js';
import teamRoutes from './routes/teams.js';
import userRoutes from './routes/users.js';
import './types.js';

export type BuildAppOptions = {
  redisUrl?: string;
  logger?: boolean;
};

function formatZodError(err: ZodError): string {
  return err.issues
    .map((issue) => {
      const path = issue.path.map(String).join('.');
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join('; ');
}

export async function buildApp(opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  const config = loadConfig();
  const app = Fastify({ logger: opts.logger ?? false });

  const redis = createRedis(opts.redisUrl ?? config.redisUrl);
  app.decorate('redis', redis);
  app.decorate('sseClients', new Set<() => void>());
  app.decorateRequest('user', null);
  app.decorateRequest('sessionToken', null);
  app.decorateRequest('team', null);

  // End open SSE streams first so the server can close, then drop Redis.
  app.addHook('preClose', async () => {
    for (const close of [...app.sseClients]) close();
  });
  app.addHook('onClose', async () => {
    try {
      await redis.quit();
    } catch {
      redis.disconnect();
    }
  });

  // JSON parser that treats an empty body as {} (e.g. POST /auth/signout with a JSON content-type).
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    const text = typeof body === 'string' ? body : body.toString('utf8');
    if (text.trim() === '') return done(null, {});
    try {
      done(null, JSON.parse(text));
    } catch {
      done(badRequest('Request body is not valid JSON'), undefined);
    }
  });

  await app.register(cookie);
  await app.register(cors, {
    origin: config.webOrigin,
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  app.setErrorHandler((err: FastifyError | AppError | ZodError | Error, request, reply) => {
    if (err instanceof AppError) {
      return reply.status(err.status).send({ error: { code: err.code, message: err.message } });
    }
    if (err instanceof ZodError) {
      return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: formatZodError(err) } });
    }
    const status = (err as FastifyError).statusCode;
    if (typeof status === 'number' && status >= 400 && status < 500) {
      // Fastify's own client errors (body parsing, content type, payload size, ...).
      const code = (err as FastifyError).code ?? '';
      const asBadRequest = code.startsWith('FST_ERR_CTP') || status === 400;
      return reply.status(asBadRequest ? 400 : status).send({
        error: { code: asBadRequest ? 'VALIDATION_ERROR' : codeForStatus(status), message: err.message },
      });
    }
    request.log.error(err);
    return reply.status(500).send({ error: { code: 'INTERNAL', message: 'Internal server error' } });
  });

  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send({ error: { code: 'NOT_FOUND', message: `Route ${request.method} ${request.url} not found` } });
  });

  const routeOpts = { prefix: '/api', cookieSecure: config.cookieSecure, webOrigin: config.webOrigin };
  await app.register(healthRoutes, routeOpts);
  await app.register(authRoutes, routeOpts);
  await app.register(userRoutes, routeOpts);
  await app.register(teamRoutes, routeOpts);
  await app.register(taskRoutes, routeOpts);
  await app.register(standupRoutes, routeOpts);
  await app.register(activityRoutes, routeOpts);
  await app.register(summaryRoutes, routeOpts);
  await app.register(eventsRoutes, routeOpts);

  return app;
}
