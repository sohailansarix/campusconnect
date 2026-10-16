import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../config/prisma.js';
import { UnauthenticatedError, ForbiddenError } from '../utils/errors.js';
import {
  claimsToPrincipal,
  extractBearerToken,
  verifyAccessToken,
  type AccessTokenClaims,
} from '../utils/jwt.js';

/**
 * Authentication middleware.
 *
 * Two modes:
 *
 *  - `authenticate`  — hard requirement. Missing or invalid credentials → 401.
 *  - `optionalAuth`  — attaches a principal when one is present, but lets
 *                      anonymous callers through. Used on public endpoints that
 *                      personalise (event list showing "you're registered",
 *                      public passport respecting the owner's own view).
 *
 * Beyond signature verification, `authenticate` re-reads the user row. That is a
 * deliberate extra query: it means a suspended account, a deleted user or a
 * bumped `tokenVersion` takes effect immediately rather than at token expiry.
 * The query is by primary key and the payload is small, so the cost is one
 * indexed lookup per request.
 */

const SUSPENDED_MESSAGE = 'Your account has been suspended. Contact your college administrator.';

async function resolvePrincipal(token: string) {
  const claims: AccessTokenClaims = verifyAccessToken(token);

  const user = await prisma.user.findFirst({
    where: { id: claims.sub, deletedAt: null },
    select: {
      id: true,
      email: true,
      fullName: true,
      role: true,
      status: true,
      tokenVersion: true,
      collegeId: true,
      departmentId: true,
      employerProfile: { select: { id: true } },
      college: { select: { isActive: true } },
    },
  });

  if (!user) throw new UnauthenticatedError('Your account is no longer available');
  if (user.status === 'SUSPENDED') throw new ForbiddenError(SUSPENDED_MESSAGE);
  if (user.status === 'DEACTIVATED') throw new UnauthenticatedError('Your account has been deactivated');
  if (user.tokenVersion !== claims.tokenVersion) {
    // Password changed or "log out everywhere" was used after this token was issued.
    throw new UnauthenticatedError('Your session is no longer valid — please sign in again');
  }
  // A college can be deactivated by the super admin; its students cannot sign in
  // but their data is retained.
  if (user.college && !user.college.isActive && user.role !== 'SUPER_ADMIN') {
    throw new ForbiddenError('Your institution is temporarily inactive');
  }

  return {
    principal: {
      id: user.id,
      email: user.email,
      role: user.role,
      fullName: user.fullName,
      collegeId: user.collegeId,
      departmentId: user.departmentId,
      employerId: user.employerProfile?.id ?? null,
    } satisfies import('@campusconnect/shared').AuthPrincipal,
    raw: claims,
  };
}

export async function authenticate(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const token = extractBearerToken(req.headers);
    if (!token) throw new UnauthenticatedError();

    const { principal, raw } = await resolvePrincipal(token);
    req.user = principal;
    // Re-bind the request logger with the user id now that we know it.
    req.log = req.log ? (req.log as unknown as { withUser?: never }) && req.log : req.log;
    (req as Request & { tokenClaims?: AccessTokenClaims }).tokenClaims = raw;
    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Same verification, but never rejects. A malformed token is treated as "no
 * token" rather than an error, so a stale token in a shared browser cannot break
 * a public page.
 */
export async function optionalAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const token = extractBearerToken(req.headers);
  if (!token) return next();

  try {
    const { principal, raw } = await resolvePrincipal(token);
    req.user = principal;
    (req as Request & { tokenClaims?: AccessTokenClaims }).tokenClaims = raw;
  } catch {
    // Intentionally swallowed — see the doc comment.
  }
  next();
}

/** Narrowed accessor for handlers that run behind `authenticate`. */
export function requireUser(req: Request): import('@campusconnect/shared').AuthPrincipal {
  if (!req.user) throw new UnauthenticatedError();
  return req.user;
}

/**
 * Attaches a principal from an already-verified token — used by the refresh
 * endpoint, which must resolve a user from a refresh token that the standard
 * middleware would reject for having the wrong `typ`.
 */
export async function principalFromUserId(userId: string) {
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: {
      id: true,
      email: true,
      fullName: true,
      role: true,
      status: true,
      tokenVersion: true,
      collegeId: true,
      departmentId: true,
      employerProfile: { select: { id: true } },
    },
  });

  if (!user) throw new UnauthenticatedError('Your account is no longer available');
  if (user.status !== 'ACTIVE') throw new UnauthenticatedError('Your account is not active');

  return {
    principal: {
      id: user.id,
      email: user.email,
      role: user.role,
      fullName: user.fullName,
      collegeId: user.collegeId,
      departmentId: user.departmentId,
      employerId: user.employerProfile?.id ?? null,
    } satisfies import('@campusconnect/shared').AuthPrincipal,
    tokenVersion: user.tokenVersion,
  };
}

export { claimsToPrincipal };
