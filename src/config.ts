import 'dotenv/config';

export type Config = {
  port: number;
  host: string;
  redisUrl: string;
  webOrigin: string;
  cookieSecure: boolean;
};

export function loadConfig(): Config {
  const env = process.env;
  const port = Number.parseInt(env.PORT ?? '4000', 10);
  return {
    port: Number.isFinite(port) ? port : 4000,
    host: env.HOST ?? '0.0.0.0',
    redisUrl: env.REDIS_URL ?? 'redis://localhost:6379',
    webOrigin: env.WEB_ORIGIN ?? 'http://localhost:5173',
    cookieSecure: (env.COOKIE_SECURE ?? 'false').toLowerCase() === 'true',
  };
}
