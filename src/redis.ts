import { Redis } from 'ioredis';

/** Main command connection. */
export function createRedis(url: string): Redis {
  return new Redis(url, { maxRetriesPerRequest: 3 });
}

/** Dedicated connection for SUBSCRIBE (a subscribed connection can't run normal commands). */
export function createSubscriber(main: Redis): Redis {
  return main.duplicate();
}
