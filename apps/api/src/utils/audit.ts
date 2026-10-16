/**
 * Audit logging.
 *
 * Every state change that a person could later be asked to justify writes a row:
 * event approvals, certificate issue/revoke, manual attendance overrides,
 * exports, role changes, bulk operations.
 *
 * Two design points:
 *
 *  * Writes are fire-and-forget. An audit insert must never fail the request it
 *    is describing — a student who successfully registered should not get a 500
 *    because the audit table was briefly unavailable. Failures are logged loudly
 *    instead. The `AuditAction` enum plus `entity`/`entityId` still give a
 *    complete picture of *what* changed even if one row is lost.
 *
 *  * The diff is field-level and redacted. `buildDiff` skips fields whose values
 *    are large blobs or personal data, so an audit row cannot itself become a
 *    PII leak or a copy of every description ever edited.
 */

import type { AuditAction, Prisma } from '@prisma/client';
import { prisma } from '../config/prisma.js';
import { logger } from '../config/logger.js';

export type AuditContext = {
  userId?: string | null;
  collegeId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
};

export type AuditInput = AuditContext & {
  action: AuditAction;
  entity: string;
  entityId?: string | null;
  changes?: Prisma.InputJsonValue | null;
  metadata?: Prisma.InputJsonValue | null;
};

/** Fields never copied into a diff — secrets, blobs and unbounded text. */
const EXCLUDED_FROM_DIFF = new Set([
  'passwordHash',
  'refreshTokenHash',
  'tokenVersion',
  'description',
  'bodyTemplate',
  'brief',
  'content',
  'answers',
  'passportSnapshot',
  'rawPayload',
  'pdfUrl',
]);

/** Personal fields are recorded as "changed" without the values. */
const PII_FIELDS = new Set(['email', 'phone', 'fullName', 'rollNumber', 'dateOfBirth', 'address']);

export type FieldDiff = {
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  changed: string[];
};

/**
 * Computes a field-level diff between two records.
 *
 * Returns null when nothing changed, so callers can skip writing a no-op row —
 * an "updated" entry with an empty diff is noise in the audit trail.
 */
export function buildDiff(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
): FieldDiff | null {
  if (!before || !after) return null;

  const changed: string[] = [];
  const beforeOut: Record<string, unknown> = {};
  const afterOut: Record<string, unknown> = {};

  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    if (EXCLUDED_FROM_DIFF.has(key)) continue;

    const prev = before[key];
    const next = after[key];
    if (isEqual(prev, next)) continue;

    changed.push(key);

    if (PII_FIELDS.has(key)) {
      // Record that it changed, not what it was — a diff is not a place to keep
      // a history of someone's old phone numbers.
      beforeOut[key] = prev === null || prev === undefined ? null : '[previous]';
      afterOut[key] = next === null || next === undefined ? null : '[updated]';
    } else {
      beforeOut[key] = truncate(prev);
      afterOut[key] = truncate(next);
    }
  }

  if (changed.length === 0) return null;
  return { before: beforeOut, after: afterOut, changed };
}

function isEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (a === null || b === null || a === undefined || b === undefined) return false;
  if (typeof a === 'object' && typeof b === 'object') {
    // Prisma decimals and similar wrappers compare by their string form.
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return false;
}

function truncate(value: unknown, maxLength = 300): unknown {
  if (value === null || value === undefined) return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    if ('toNumber' in value || 'toString' in value) return String(value);
    const json = JSON.stringify(value);
    return json.length > maxLength ? `${json.slice(0, maxLength)}…` : JSON.parse(json);
  }
  if (typeof value === 'string' && value.length > maxLength) return `${value.slice(0, maxLength)}…`;
  return value;
}

/* -------------------------------------------------------------------------- */
/* Write helpers                                                              */
/* -------------------------------------------------------------------------- */

export function writeAudit(input: AuditInput): void {
  void prisma.auditLog
    .create({
      data: {
        userId: input.userId ?? null,
        collegeId: input.collegeId ?? null,
        action: input.action,
        entity: input.entity,
        entityId: input.entityId ?? null,
        changes: input.changes ?? undefined,
        metadata: input.metadata ?? undefined,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
        requestId: input.requestId ?? null,
      },
    })
    .catch((error: unknown) => {
      // Never propagate — see the header comment.
      logger.error('Failed to write audit log', error, {
        action: input.action,
        entity: input.entity,
        entityId: input.entityId ?? undefined,
      });
    });
}

/** Audit a create, with the new record's identifying fields as metadata. */
export function auditCreate(
  ctx: AuditContext,
  entity: string,
  entityId: string,
  metadata?: Record<string, unknown>,
): void {
  writeAudit({ ...ctx, action: 'CREATE', entity, entityId, metadata: (metadata ?? null) as Prisma.InputJsonValue });
}

/** Audit an update. Skips the write entirely when nothing actually changed. */
export function auditUpdate(
  ctx: AuditContext,
  entity: string,
  entityId: string,
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
  metadata?: Record<string, unknown>,
): void {
  const diff = buildDiff(before, after);
  if (!diff) return;
  writeAudit({
    ...ctx,
    action: 'UPDATE',
    entity,
    entityId,
    changes: diff as unknown as Prisma.InputJsonValue,
    metadata: (metadata ?? null) as Prisma.InputJsonValue,
  });
}

export function auditDelete(
  ctx: AuditContext,
  entity: string,
  entityId: string,
  metadata?: Record<string, unknown>,
): void {
  writeAudit({ ...ctx, action: 'DELETE', entity, entityId, metadata: (metadata ?? null) as Prisma.InputJsonValue });
}

export function auditAction(
  ctx: AuditContext,
  action: AuditAction,
  entity: string,
  entityId: string | null,
  metadata?: Record<string, unknown>,
): void {
  writeAudit({ ...ctx, action, entity, entityId, metadata: (metadata ?? null) as Prisma.InputJsonValue });
}

/** Bulk operations summarise rather than writing one row per affected record. */
export function auditBulk(
  ctx: AuditContext,
  action: AuditAction,
  entity: string,
  affectedIds: string[],
  metadata?: Record<string, unknown>,
): void {
  writeAudit({
    ...ctx,
    action,
    entity,
    entityId: null,
    metadata: {
      ...(metadata ?? {}),
      affectedCount: affectedIds.length,
      // Cap the id list so a 2,000-certificate bulk issue does not write a
      // 60KB JSON blob into a single audit row.
      affectedIds: affectedIds.slice(0, 50),
      truncated: affectedIds.length > 50,
    } as Prisma.InputJsonValue,
  });
}

/**
 * Reads recent audit rows for the admin UI.
 *
 * Wrapped here rather than exposed via a generic query builder so the read path
 * cannot be pointed at an arbitrary table.
 */
export async function listAuditLogs(params: {
  collegeId?: string | null;
  entity?: string;
  entityId?: string;
  userId?: string;
  action?: AuditAction;
  skip: number;
  take: number;
}) {
  const where = {
    ...(params.collegeId ? { collegeId: params.collegeId } : {}),
    ...(params.entity ? { entity: params.entity } : {}),
    ...(params.entityId ? { entityId: params.entityId } : {}),
    ...(params.userId ? { userId: params.userId } : {}),
    ...(params.action ? { action: params.action } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: params.skip,
      take: params.take,
      select: {
        id: true,
        action: true,
        entity: true,
        entityId: true,
        changes: true,
        metadata: true,
        ipAddress: true,
        requestId: true,
        createdAt: true,
        // Only the actor's name and role — the audit list is not a place to
        // re-expose contact details.
        user: { select: { id: true, fullName: true, role: true } },
      },
    }),
    prisma.auditLog.count({ where }),
  ]);

  return { items, total };
}
