import type { FastifyPluginAsync } from 'fastify';
import type { Redis } from 'ioredis';
import { z } from 'zod';
import { dateSchema, nowIso } from '../lib/dates.js';
import { emit } from '../lib/events.js';
import { badRequest, notFound } from '../lib/errors.js';
import { newId } from '../lib/ids.js';
import { keys } from '../lib/keys.js';
import { hashOrNull, serializeTask } from '../lib/serializers.js';
import { parse } from '../lib/validate.js';
import { authUser, member, memberTeam } from '../plugins/auth.js';
import { TASK_STATUSES, type RouteOptions, type Task, type TaskHash, type TaskStatus } from '../types.js';

const statusSchema = z.enum(['todo', 'in_progress', 'done']);
const titleSchema = z.string().trim().min(1, 'Title is required').max(200, 'Title must be at most 200 characters');
const descriptionSchema = z.string().max(5000, 'Description must be at most 5000 characters');

const createSchema = z.object({
  title: titleSchema,
  description: descriptionSchema.optional(),
  assigneeId: z.string().nullable().optional(),
  dueDate: dateSchema.nullable().optional(),
  status: statusSchema.optional(),
});

const updateSchema = z.object({
  title: titleSchema.optional(),
  description: descriptionSchema.optional(),
  assigneeId: z.string().nullable().optional(),
  dueDate: dateSchema.nullable().optional(),
});

const moveSchema = z.object({
  status: statusSchema,
  index: z.number().int('index must be an integer'),
});

/**
 * Atomically move a task: remove it from its current column, insert it into the
 * target column at the clamped index, and update status/updatedAt/completedAt.
 * KEYS: task hash, todo list, in_progress list, done list.
 * ARGV: taskId, newStatus, index, nowIso. Returns {oldStatus, index, completedAt}.
 */
const MOVE_SCRIPT = `
local taskKey = KEYS[1]
local status = redis.call('HGET', taskKey, 'status')
if not status then return false end
local cols = { todo = KEYS[2], in_progress = KEYS[3], done = KEYS[4] }
local id, newStatus, now = ARGV[1], ARGV[2], ARGV[4]
local index = tonumber(ARGV[3])
redis.call('LREM', cols[status], 0, id)
local target = cols[newStatus]
redis.call('LREM', target, 0, id)
local len = redis.call('LLEN', target)
if index < 0 then index = 0 end
if index > len then index = len end
if index == len then
  redis.call('RPUSH', target, id)
else
  local pivot = redis.call('LINDEX', target, index)
  redis.call('LINSERT', target, 'BEFORE', pivot, id)
end
local completedAt = redis.call('HGET', taskKey, 'completedAt') or ''
if newStatus == 'done' and status ~= 'done' then completedAt = now end
if newStatus ~= 'done' then completedAt = '' end
redis.call('HSET', taskKey, 'status', newStatus, 'updatedAt', now, 'completedAt', completedAt)
return { status, tostring(index), completedAt }
`;

const taskParams = z.object({ teamId: z.string(), taskId: z.string() });

async function assertAssignee(redis: Redis, teamId: string, assigneeId: string | null | undefined) {
  if (!assigneeId) return;
  const ok = await redis.sismember(keys.teamMembers(teamId), assigneeId);
  if (!ok) throw badRequest('assigneeId must be a member of the team');
}

async function loadTask(redis: Redis, teamId: string, taskId: string): Promise<TaskHash> {
  const task = hashOrNull<TaskHash>(await redis.hgetall(keys.task(taskId)));
  if (!task || task.teamId !== teamId) throw notFound('Task not found');
  return task;
}

const taskRoutes: FastifyPluginAsync<RouteOptions> = async (app) => {
  const redis = app.redis;

  app.get('/teams/:teamId/tasks', { preHandler: member }, async (request) => {
    const team = memberTeam(request);
    const columns = {} as Record<TaskStatus, Task[]>;
    for (const status of TASK_STATUSES) {
      const ids = await redis.lrange(keys.column(team.id, status), 0, -1);
      const pipe = redis.pipeline();
      for (const id of ids) pipe.hgetall(keys.task(id));
      const results = ids.length ? ((await pipe.exec()) ?? []) : [];
      columns[status] = results
        .map(([, value]) => hashOrNull<TaskHash>(value as Record<string, string>))
        .filter((t): t is TaskHash => t !== null)
        .map(serializeTask);
    }
    return { columns };
  });

  app.post('/teams/:teamId/tasks', { preHandler: member }, async (request, reply) => {
    const user = authUser(request);
    const team = memberTeam(request);
    const body = parse(createSchema, request.body);
    await assertAssignee(redis, team.id, body.assigneeId);
    const now = nowIso();
    const status = body.status ?? 'todo';
    const task: TaskHash = {
      id: newId(),
      teamId: team.id,
      title: body.title,
      description: body.description ?? '',
      status,
      assigneeId: body.assigneeId ?? '',
      dueDate: body.dueDate ?? '',
      createdBy: user.id,
      createdAt: now,
      updatedAt: now,
      completedAt: status === 'done' ? now : '',
    };
    await redis.multi().hset(keys.task(task.id), task).rpush(keys.column(team.id, status), task.id).exec();
    await emit(redis, team.id, ['tasks', 'activity'], {
      type: 'task.created',
      actorId: user.id,
      data: { taskId: task.id, title: task.title, status },
    });
    return reply.status(201).send({ task: serializeTask(task) });
  });

  app.patch('/teams/:teamId/tasks/:taskId', { preHandler: member }, async (request) => {
    const user = authUser(request);
    const team = memberTeam(request);
    const { taskId } = parse(taskParams, request.params);
    const body = parse(updateSchema, request.body);
    const task = await loadTask(redis, team.id, taskId);
    await assertAssignee(redis, team.id, body.assigneeId);

    const changes: Partial<TaskHash> = {};
    if (body.title !== undefined) changes.title = body.title;
    if (body.description !== undefined) changes.description = body.description;
    if (body.assigneeId !== undefined) changes.assigneeId = body.assigneeId ?? '';
    if (body.dueDate !== undefined) changes.dueDate = body.dueDate ?? '';
    const updated: TaskHash = { ...task, ...changes, updatedAt: nowIso() };
    await redis.hset(keys.task(task.id), { ...changes, updatedAt: updated.updatedAt });
    await emit(redis, team.id, ['tasks', 'activity'], {
      type: 'task.updated',
      actorId: user.id,
      data: { taskId: task.id, title: updated.title, fields: Object.keys(changes) },
    });
    return { task: serializeTask(updated) };
  });

  app.post('/teams/:teamId/tasks/:taskId/move', { preHandler: member }, async (request) => {
    const user = authUser(request);
    const team = memberTeam(request);
    const { taskId } = parse(taskParams, request.params);
    const body = parse(moveSchema, request.body);

    const task = await loadTask(redis, team.id, taskId);
    const now = nowIso();
    const result = (await redis.eval(
      MOVE_SCRIPT,
      4,
      keys.task(task.id),
      keys.column(team.id, 'todo'),
      keys.column(team.id, 'in_progress'),
      keys.column(team.id, 'done'),
      task.id,
      body.status,
      String(body.index),
      now,
    )) as [string, string, string] | null;
    if (!result) throw notFound('Task not found');
    const [from, index, completedAt] = result;

    const moved: TaskHash = { ...task, status: body.status, updatedAt: now, completedAt };
    await emit(redis, team.id, ['tasks', 'activity'], {
      type: 'task.moved',
      actorId: user.id,
      data: { taskId: task.id, title: task.title, from, to: body.status, index: Number(index) },
    });
    return { task: serializeTask(moved) };
  });

  app.delete('/teams/:teamId/tasks/:taskId', { preHandler: member }, async (request, reply) => {
    const user = authUser(request);
    const team = memberTeam(request);
    const { taskId } = parse(taskParams, request.params);
    const task = await loadTask(redis, team.id, taskId);
    const multi = redis.multi();
    for (const status of TASK_STATUSES) multi.lrem(keys.column(team.id, status), 0, task.id);
    await multi.del(keys.task(task.id)).exec();
    await emit(redis, team.id, ['tasks', 'activity'], {
      type: 'task.deleted',
      actorId: user.id,
      data: { taskId: task.id, title: task.title },
    });
    return reply.status(204).send();
  });
};

export default taskRoutes;
