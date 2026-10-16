import bcrypt from 'bcryptjs';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';
import { nowIso } from '../lib/dates.js';
import { conflict, unauthorized } from '../lib/errors.js';
import { newId, newSessionToken } from '../lib/ids.js';
import { keys, SESSION_TTL_SECONDS } from '../lib/keys.js';
import { serializeUser } from '../lib/serializers.js';
import { getUser } from '../lib/users.js';
import { parse } from '../lib/validate.js';
import { authed, authUser, SESSION_COOKIE, sessionCookieOptions } from '../plugins/auth.js';
import type { RouteOptions, UserHash } from '../types.js';

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ message: 'Must be a valid email address' }).max(254));

const signupSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
  email: emailSchema,
  password: z.string().min(8, 'Password must be at least 8 characters').max(200),
});

const signinSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required').max(200),
});

const authRoutes: FastifyPluginAsync<RouteOptions> = async (app, opts) => {
  const redis = app.redis;

  async function startSession(reply: FastifyReply, userId: string) {
    const token = newSessionToken();
    await redis.set(keys.session(token), userId, 'EX', SESSION_TTL_SECONDS);
    reply.setCookie(SESSION_COOKIE, token, sessionCookieOptions(opts.cookieSecure));
  }

  app.post('/auth/signup', async (request, reply) => {
    const body = parse(signupSchema, request.body);
    const passwordHash = await bcrypt.hash(body.password, 10);
    const id = newId();
    const claimed = await redis.set(keys.userEmail(body.email), id, 'NX');
    if (claimed !== 'OK') throw conflict('An account with this email already exists');
    const user: UserHash = { id, name: body.name, email: body.email, passwordHash, createdAt: nowIso() };
    await redis.hset(keys.user(id), user);
    await startSession(reply, id);
    return reply.status(201).send({ user: serializeUser(user) });
  });

  app.post('/auth/signin', async (request, reply) => {
    const body = parse(signinSchema, request.body);
    const userId = await redis.get(keys.userEmail(body.email));
    const user = userId ? await getUser(redis, userId) : null;
    if (!user || !(await bcrypt.compare(body.password, user.passwordHash))) {
      throw unauthorized('Invalid email or password');
    }
    await startSession(reply, user.id);
    return { user: serializeUser(user) };
  });

  app.post('/auth/signout', { preHandler: authed }, async (request, reply) => {
    if (request.sessionToken) await redis.del(keys.session(request.sessionToken));
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.status(204).send();
  });

  app.get('/auth/me', { preHandler: authed }, async (request) => {
    return { user: serializeUser(authUser(request)) };
  });
};

export default authRoutes;
