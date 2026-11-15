import { z } from 'zod';

z.config({ jitless: true });

export { z };

const MAX_LISTED_ISSUES = 3;

function describeIssue(issue: z.core.$ZodIssue): string {
  const path = issue.path.map(String).join('.');
  return `${path === '' ? '(root)' : path}: ${issue.message}`;
}

export class ResponseShapeError extends Error {
  constructor(
    readonly source: string,
    issues: readonly z.core.$ZodIssue[]
  ) {
    const listed = issues.slice(0, MAX_LISTED_ISSUES).map(describeIssue).join('; ');
    const more =
      issues.length > MAX_LISTED_ISSUES ? ` (+${issues.length - MAX_LISTED_ISSUES} more)` : '';
    super(`Unexpected data from ${source}: ${listed}${more}`);
    this.name = 'ResponseShapeError';
  }
}

function dropNull(value: unknown): unknown {
  return value === null ? undefined : value;
}

export function nullOrAbsent<T>(schema: z.ZodType<T>) {
  return z.preprocess(dropNull, schema.optional());
}

export function parseWith<T>(schema: z.ZodType<T>, value: unknown, source: string): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new ResponseShapeError(source, result.error.issues);
  return result.data;
}
