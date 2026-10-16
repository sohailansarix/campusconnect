import type { Request } from 'express';
import type { AuditContext } from './audit.js';

/**
 * Builds an audit context from the current request.
 *
 * Extracted to its own module so controllers do not each re-derive the same four
 * fields, and so the shape stays consistent across modules — an audit row missing
 * its `requestId` is far less useful for tracing.
 */
export function auditContextOf(req: Request): AuditContext {
  return {
    userId: req.user?.id ?? null,
    collegeId: req.user?.collegeId ?? null,
    ipAddress: req.ip ?? null,
    userAgent: req.headers['user-agent']?.slice(0, 300) ?? null,
    requestId: req.requestId ?? null,
  };
}

/**
 * Audit context for a request performed on behalf of another user or tenant —
 * e.g. a super admin creating a college. The actor is the caller; the college is
 * the target.
 */
export function auditContextFor(req: Request, targetCollegeId: string | null): AuditContext {
  return { ...auditContextOf(req), collegeId: targetCollegeId };
}
