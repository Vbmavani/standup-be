import { z } from 'zod';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** True for a real calendar date in YYYY-MM-DD form. */
export function isValidDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export const dateSchema = z
  .string()
  .refine(isValidDate, { message: 'Must be a valid date in YYYY-MM-DD format' });

export const nowIso = (): string => new Date().toISOString();

export const todayUtc = (): string => new Date().toISOString().slice(0, 10);

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Monday (UTC) of the week containing `date` (defaults to today). */
export function mondayOf(date: string = todayUtc()): string {
  const d = new Date(`${date}T00:00:00Z`);
  const dow = d.getUTCDay(); // 0 = Sunday
  const diff = dow === 0 ? -6 : 1 - dow;
  return addDays(date, diff);
}
