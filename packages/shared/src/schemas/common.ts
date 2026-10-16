import { z } from 'zod';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, SORT_ORDERS } from '../constants.js';

/* -------------------------------------------------------------------------- */
/* Primitives                                                                 */
/* -------------------------------------------------------------------------- */

export const cuidSchema = z.string().cuid({ message: 'Invalid identifier' });

export const idParamSchema = z.object({ id: cuidSchema });
export const usernameParamSchema = z.object({
  username: z
    .string()
    .min(3)
    .max(40)
    .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, 'Lowercase letters, numbers and hyphens only'),
});

/**
 * Express gives us query values as strings (or arrays when a param repeats).
 * These helpers normalise them before the domain schema sees them.
 */
export const booleanQuery = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((v) => v === true || v === 'true' || v === '1');

export const optionalBooleanQuery = booleanQuery.optional();

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  sortBy: z.string().trim().max(50).optional(),
  sortOrder: z.enum(SORT_ORDERS).default('desc'),
});

export const searchSchema = z.object({
  search: z.string().trim().min(1).max(120).optional(),
});

/** Every list endpoint composes these. */
export const listQuerySchema = paginationSchema.merge(searchSchema);

export type ListQueryInput = z.infer<typeof listQuerySchema>;

/**
 * Date-range filter. `from` is inclusive at 00:00, `to` inclusive at 23:59:59
 * via `endOfDay` in the service layer.
 */
export const dateRangeSchema = z
  .object({
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, {
    message: '`from` must be before `to`',
    path: ['from'],
  });

/** Comma-separated multi-select, e.g. `?categories=WORKSHOP,FEST`. */
export function csvArray<T extends z.ZodTypeAny>(itemSchema: T) {
  return z
    .union([z.string(), z.array(z.string())])
    .transform((v) => (Array.isArray(v) ? v : v.split(',')))
    .pipe(z.array(itemSchema).min(1))
    .optional();
}

/** Money in the smallest currency unit (paise/cents) — never a float. */
export const amountSchema = z.coerce.number().int().min(0).max(100_000_00);

export const urlOrPathSchema = z
  .string()
  .trim()
  .max(500)
  .refine(
    (v) => /^https?:\/\//.test(v) || v.startsWith('/'),
    'Must be an absolute URL or an app-relative path',
  );
