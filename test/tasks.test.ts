import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { as, createTeam, createTestApp, joinTeam, signup, type TestUser } from './helpers.js';

let app: FastifyInstance;
let owner: TestUser;
let bob: TestUser;
let teamId: string;

beforeAll(async () => {
  app = await createTestApp();
});
beforeEach(async () => {
  await app.redis.flushdb();
  owner = await signup(app, { name: 'Owner' });
  bob = await signup(app, { name: 'Bob' });
  const team = await createTeam(app, owner.cookie);
  teamId = team.id;
  await joinTeam(app, bob.cookie, team.inviteCode);
});
afterAll(async () => {
  await app.close();
});

const base = () => `/api/teams/${teamId}/tasks`;

async function create(title: string, extra: Record<string, unknown> = {}) {
  const res = await as(app, owner.cookie).post(base(), { title, ...extra });
  expect(res.statusCode).toBe(201);
  return res.json().task as { id: string; status: string; completedAt: string | null };
}

async function columnTitles() {
  const res = await as(app, owner.cookie).get(base());
  expect(res.statusCode).toBe(200);
  const cols = res.json().columns as Record<string, { title: string }[]>;
  return {
    todo: cols.todo!.map((t) => t.title),
    in_progress: cols.in_progress!.map((t) => t.title),
    done: cols.done!.map((t) => t.title),
  };
}

describe('tasks', () => {
  it('creates a task with defaults and nulls for empty optional fields', async () => {
    const res = await as(app, owner.cookie).post(base(), { title: '  Write docs ' });
    expect(res.statusCode).toBe(201);
    expect(res.json().task).toEqual({
      id: expect.any(String),
      teamId,
      title: 'Write docs',
      description: '',
      status: 'todo',
      assigneeId: null,
      dueDate: null,
      createdBy: owner.user.id,
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
      completedAt: null,
    });
  });

  it('appends to the end of its column and lists columns in order', async () => {
    await create('A');
    await create('B');
    await create('C', { status: 'in_progress' });
    const d = await create('D', { status: 'done' });
    expect(d.completedAt).not.toBeNull();
    expect(await columnTitles()).toEqual({ todo: ['A', 'B'], in_progress: ['C'], done: ['D'] });
  });

  it('validates title, description, dueDate and assignee', async () => {
    const api = as(app, owner.cookie);
    expect((await api.post(base(), { title: '' })).statusCode).toBe(400);
    expect((await api.post(base(), { title: 'x'.repeat(201) })).statusCode).toBe(400);
    expect((await api.post(base(), { title: 'ok', description: 'x'.repeat(5001) })).statusCode).toBe(400);
    expect((await api.post(base(), { title: 'ok', dueDate: '2026-13-01' })).statusCode).toBe(400);
    expect((await api.post(base(), { title: 'ok', status: 'archived' })).statusCode).toBe(400);
    const stranger = await signup(app);
    const bad = await api.post(base(), { title: 'ok', assigneeId: stranger.user.id });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('updates fields, including clearing assignee and due date with null', async () => {
    const t = await create('Edit me');
    const api = as(app, owner.cookie);
    const res = await api.patch(`${base()}/${t.id}`, {
      title: 'Edited',
      description: 'Some details',
      assigneeId: bob.user.id,
      dueDate: '2026-11-01',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().task).toMatchObject({
      title: 'Edited',
      description: 'Some details',
      assigneeId: bob.user.id,
      dueDate: '2026-11-01',
    });
    const cleared = await api.patch(`${base()}/${t.id}`, { assigneeId: null, dueDate: null });
    expect(cleared.json().task).toMatchObject({ title: 'Edited', assigneeId: null, dueDate: null });

    const stranger = await signup(app);
    expect((await api.patch(`${base()}/${t.id}`, { assigneeId: stranger.user.id })).statusCode).toBe(400);
    expect((await api.patch(`${base()}/nope`, { title: 'x' })).statusCode).toBe(404);
  });

  it('moves within a column', async () => {
    const a = await create('A');
    await create('B');
    await create('C');
    const api = as(app, owner.cookie);
    let res = await api.post(`${base()}/${a.id}/move`, { status: 'todo', index: 2 });
    expect(res.statusCode).toBe(200);
    expect((await columnTitles()).todo).toEqual(['B', 'C', 'A']);
    res = await api.post(`${base()}/${a.id}/move`, { status: 'todo', index: 1 });
    expect((await columnTitles()).todo).toEqual(['B', 'A', 'C']);
    res = await api.post(`${base()}/${a.id}/move`, { status: 'todo', index: 0 });
    expect((await columnTitles()).todo).toEqual(['A', 'B', 'C']);
    // clamped
    res = await api.post(`${base()}/${a.id}/move`, { status: 'todo', index: 99 });
    expect((await columnTitles()).todo).toEqual(['B', 'C', 'A']);
    res = await api.post(`${base()}/${a.id}/move`, { status: 'todo', index: -5 });
    expect((await columnTitles()).todo).toEqual(['A', 'B', 'C']);
  });

  it('moves across columns, sets and clears completedAt', async () => {
    const a = await create('A');
    await create('B');
    await create('X', { status: 'done' });
    await create('Y', { status: 'done' });
    const api = as(app, owner.cookie);

    let res = await api.post(`${base()}/${a.id}/move`, { status: 'done', index: 1 });
    expect(res.statusCode).toBe(200);
    expect(res.json().task.status).toBe('done');
    const completedAt = res.json().task.completedAt;
    expect(completedAt).toEqual(expect.any(String));
    expect(await columnTitles()).toEqual({ todo: ['B'], in_progress: [], done: ['X', 'A', 'Y'] });

    // reorder inside done keeps completedAt
    res = await api.post(`${base()}/${a.id}/move`, { status: 'done', index: 0 });
    expect(res.json().task.completedAt).toBe(completedAt);

    res = await api.post(`${base()}/${a.id}/move`, { status: 'in_progress', index: 0 });
    expect(res.json().task.completedAt).toBeNull();
    expect(await columnTitles()).toEqual({ todo: ['B'], in_progress: ['A'], done: ['X', 'Y'] });

    const listed = (await api.get(base())).json().columns.in_progress[0];
    expect(listed.completedAt).toBeNull();
    expect(listed.status).toBe('in_progress');

    expect((await api.post(`${base()}/${a.id}/move`, { status: 'nope', index: 0 })).statusCode).toBe(400);
    expect((await api.post(`${base()}/${a.id}/move`, { status: 'done' })).statusCode).toBe(400);
  });

  it('deletes a task from its column and removes the hash', async () => {
    const a = await create('A');
    await create('B');
    const api = as(app, bob.cookie);
    const res = await api.delete(`${base()}/${a.id}`);
    expect(res.statusCode).toBe(204);
    expect((await columnTitles()).todo).toEqual(['B']);
    expect(await app.redis.exists(`task:${a.id}`)).toBe(0);
    expect((await api.delete(`${base()}/${a.id}`)).statusCode).toBe(404);
  });

  it('does not expose tasks from another team', async () => {
    const t = await create('Mine');
    const other = await createTeam(app, bob.cookie, 'Other');
    const res = await as(app, bob.cookie).patch(`/api/teams/${other.id}/tasks/${t.id}`, { title: 'x' });
    expect(res.statusCode).toBe(404);
  });
});
