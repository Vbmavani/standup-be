import type { z } from 'zod';

/** Parse with zod; ZodErrors are turned into 400 VALIDATION_ERROR by the central error handler. */
export function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  return schema.parse(input ?? {});
}
