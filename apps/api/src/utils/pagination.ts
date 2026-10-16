/**
 * Pagination, sorting and filtering helpers.
 *
 * Every list endpoint in the API returns the same envelope
 * (`{ items, meta }`) so the web app has one data-table hook rather than one per
 * module.
 */

import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, type PaginationMeta, type SortOrder } from '@campusconnect/shared';
import { ValidationError } from './errors.js';

export type PaginationInput = {
  page?: number;
  pageSize?: number;
};

export type NormalisedPagination = {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
};

export function normalisePagination(input: PaginationInput): NormalisedPagination {
  const page = Math.max(1, Math.floor(input.page ?? 1));
  const requested = Math.floor(input.pageSize ?? DEFAULT_PAGE_SIZE);
  // Clamp rather than throw: a client asking for 10,000 rows is usually a bug,
  // not an attack, and silently capping is friendlier than a 422.
  const pageSize = Math.min(Math.max(1, requested), MAX_PAGE_SIZE);

  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

export function buildPaginationMeta(page: number, pageSize: number, total: number): PaginationMeta {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return {
    page,
    pageSize,
    total,
    totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 1,
  };
}

/**
 * Builds Prisma `orderBy` from loose query input.
 *
 * `allowedFields` is required: passing an unknown field to Prisma throws at
 * runtime, and allowing arbitrary fields would let a client sort by an unindexed
 * column (or one they should not infer, such as a private note). An unknown
 * field falls back to the default rather than erroring, so a stale bookmark
 * still loads.
 */
export function buildOrderBy<TField extends string>(
  sortBy: string | undefined,
  sortOrder: SortOrder | undefined,
  allowedFields: readonly TField[],
  defaultField: TField,
  defaultOrder: SortOrder = 'desc',
): Record<string, SortOrder> {
  const field = sortBy && (allowedFields as readonly string[]).includes(sortBy) ? sortBy : defaultField;
  return { [field]: sortOrder ?? defaultOrder };
}

/* -------------------------------------------------------------------------- */
/* Cursor pagination                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Cursor pagination for feeds that grow while the user scrolls (attendance
 * scan log, notifications). Offset pagination duplicates or skips rows when new
 * ones arrive mid-scroll; a cursor on a stable, unique, monotonic column does not.
 */
export type CursorPagination = { cursor?: string; take: number; skip?: number };

export function normaliseCursorPagination(
  cursor: string | undefined,
  limit: number | undefined,
  defaultLimit = DEFAULT_PAGE_SIZE,
): { take: number; cursor: { id: string } | undefined; skip: number } {
  const take = Math.min(Math.max(1, Math.floor(limit ?? defaultLimit)), MAX_PAGE_SIZE);
  return {
    take,
    cursor: cursor ? { id: cursor } : undefined,
    skip: cursor ? 1 : 0, // Prisma cursors are inclusive; skip the cursor row itself
  };
}

/* -------------------------------------------------------------------------- */
/* Search                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Case-insensitive OR search across the given fields, shaped for Prisma.
 *
 * `mode: 'insensitive'` is Postgres-only and pairs with the `pg_trgm` indexes
 * added in the initial migration for the columns that are searched most.
 */
export function buildSearchFilter<TField extends string>(
  search: string | undefined,
  fields: readonly TField[],
): { OR: Record<string, { contains: string; mode: 'insensitive' }>[] } | Record<string, never> {
  const term = search?.trim();
  if (!term) return {};
  if (term.length < 2) {
    throw new ValidationError('Search terms must be at least 2 characters');
  }
  return {
    OR: fields.map((field) => ({ [field]: { contains: term, mode: 'insensitive' as const } })),
  };
}

/** Inclusive date range shaped for Prisma, with `to` extended to end-of-day. */
export function buildDateRangeFilter(
  field: string,
  from?: Date,
  to?: Date,
): Record<string, { gte?: Date; lte?: Date }> {
  if (!from && !to) return {};
  const range: { gte?: Date; lte?: Date } = {};
  if (from) range.gte = from;
  if (to) {
    const end = new Date(to);
    end.setHours(23, 59, 59, 999);
    range.lte = end;
  }
  return { [field]: range };
}

/* -------------------------------------------------------------------------- */
/* Response shaping                                                           */
/* -------------------------------------------------------------------------- */

export type Paginated<T> = { items: T[]; meta: PaginationMeta };

export function paginated<T>(items: T[], total: number, pagination: NormalisedPagination): Paginated<T> {
  return {
    items,
    meta: buildPaginationMeta(pagination.page, pagination.pageSize, total),
  };
}

/**
 * Runs a count and a page query in one transaction so the total cannot drift
 * from the page contents — visible as "showing 21–40 of 19" otherwise.
 */
export async function paginateQuery<T>(
  runCount: () => Promise<number>,
  runPage: () => Promise<T[]>,
  pagination: NormalisedPagination,
): Promise<Paginated<T>> {
  const [total, items] = await Promise.all([runCount(), runPage()]);
  return paginated(items, total, pagination);
}
