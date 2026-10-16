import type { Redis } from 'ioredis';
import type { UserHash } from '../types.js';
import { keys } from './keys.js';
import { hashOrNull } from './serializers.js';

export async function getUser(redis: Redis, id: string): Promise<UserHash | null> {
  return hashOrNull<UserHash>(await redis.hgetall(keys.user(id)));
}

/** Fetch several users at once; missing users are omitted from the map. */
export async function getUsers(redis: Redis, ids: Iterable<string>): Promise<Map<string, UserHash>> {
  const unique = [...new Set(ids)];
  const out = new Map<string, UserHash>();
  if (unique.length === 0) return out;
  const pipe = redis.pipeline();
  for (const id of unique) pipe.hgetall(keys.user(id));
  const results = (await pipe.exec()) ?? [];
  results.forEach(([err, value], i) => {
    if (err) throw err;
    const u = hashOrNull<UserHash>(value as Record<string, string>);
    const id = unique[i];
    if (u && id) out.set(id, u);
  });
  return out;
}
