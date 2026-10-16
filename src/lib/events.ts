import type { Redis } from 'ioredis';
import type { ActivityType, EventType } from '../types.js';
import { nowIso } from './dates.js';
import { keys } from './keys.js';

export type ActivityInput = { type: ActivityType; actorId: string; data: Record<string, unknown> };

/**
 * Append to the team's capped activity stream (if given) and publish each
 * event type to the team's pub/sub channel.
 */
export async function emit(
  redis: Redis,
  teamId: string,
  events: EventType[],
  activity?: ActivityInput,
): Promise<void> {
  const pipe = redis.pipeline();
  if (activity) {
    pipe.xadd(
      keys.activity(teamId),
      'MAXLEN',
      '~',
      '1000',
      '*',
      'type',
      activity.type,
      'actorId',
      activity.actorId,
      'data',
      JSON.stringify(activity.data),
      'createdAt',
      nowIso(),
    );
  }
  for (const type of events) pipe.publish(keys.events(teamId), JSON.stringify({ type }));
  await pipe.exec();
}
