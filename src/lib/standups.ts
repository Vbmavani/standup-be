import type { StoredStandup } from '../types.js';

export function parseStoredStandup(raw: string | undefined): StoredStandup | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<StoredStandup>;
    return {
      yesterday: v.yesterday ?? '',
      today: v.today ?? '',
      blockers: v.blockers ?? '',
      updatedAt: v.updatedAt ?? '',
    };
  } catch {
    return null;
  }
}
