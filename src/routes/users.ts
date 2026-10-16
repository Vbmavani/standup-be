import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { keys } from '../lib/keys.js';
import { serializeUser } from '../lib/serializers.js';
import { parse } from '../lib/validate.js';
import { authed, authUser } from '../plugins/auth.js';
import type { RouteOptions } from '../types.js';

const updateMeSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
});

const userRoutes: FastifyPluginAsync<RouteOptions> = async (app) => {
  app.patch('/users/me', { preHandler: authed }, async (request) => {
    const user = authUser(request);
    const body = parse(updateMeSchema, request.body);
    await app.redis.hset(keys.user(user.id), 'name', body.name);
    return { user: serializeUser({ ...user, name: body.name }) };
  });
};

export default userRoutes;
