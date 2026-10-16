import type { NextFunction, Request, RequestHandler, Response } from 'express';
import {
  roleHasAllPermissions,
  roleHasAnyPermission,
  type Permission,
  type Role,
} from '@campusconnect/shared';
import { ForbiddenError, UnauthenticatedError } from '../utils/errors.js';

/**
 * Authorisation middleware.
 *
 * The permission matrix lives in `@campusconnect/shared/rbac.ts`; this module is
 * only the enforcement point. Nothing here knows what a "club lead" is — it
 * compares the caller's role against the declared permission and either passes
 * or throws.
 *
 * Every mutating route must declare a permission. A route with no permission
 * middleware is a bug, so `assertPublicOrGuarded` exists for the rare deliberate
 * exception (public certificate verification) and makes it explicit in the code.
 */

/** Requires the caller to hold *every* listed permission. */
export function requirePermission(...permissions: Permission[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      const user = req.user;
      if (!user) throw new UnauthenticatedError();

      if (!roleHasAllPermissions(user.role, permissions)) {
        throw new ForbiddenError(describeMissing(user.role, permissions));
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

/** Requires the caller to hold *at least one* of the listed permissions. */
export function requireAnyPermission(...permissions: Permission[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      const user = req.user;
      if (!user) throw new UnauthenticatedError();

      if (!roleHasAnyPermission(user.role, permissions)) {
        throw new ForbiddenError(describeMissing(user.role, permissions));
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

/** Restricts a route to specific roles, for cases where a role is the concept. */
export function requireRole(...roles: Role[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      const user = req.user;
      if (!user) throw new UnauthenticatedError();
      if (!roles.includes(user.role)) {
        throw new ForbiddenError(`This action is limited to ${roles.join(', ').toLowerCase().replace(/_/g, ' ')}`);
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Allows the request through only when the caller is a member of the college
 * named by the given param or body field. Complements the service-layer
 * `assertSameCollege` guard.
 *
 * Super admins are exempt: they are the platform operator and legitimately act
 * across tenants.
 */
export function requireSameCollege(source: 'params' | 'body' | 'query' = 'body', field = 'collegeId'): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      const user = req.user;
      if (!user) throw new UnauthenticatedError();
      if (user.role === 'SUPER_ADMIN') return next();

      const source_ = req[source] as Record<string, unknown> | undefined;
      const targetCollegeId = source_?.[field];

      if (typeof targetCollegeId === 'string' && targetCollegeId !== user.collegeId) {
        throw new ForbiddenError('You can only act within your own institution');
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

/* -------------------------------------------------------------------------- */
/* Ownership                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Owner-or-privileged guard.
 *
 * `resolveOwnerId` is a function rather than a field name because ownership is
 * often indirect — an application's owner is `application.userId`, but the
 * caller may only have the application id.
 *
 * Used as route-level middleware so a controller cannot forget the check.
 */
export function requireOwnership<T = unknown>(
  resolveOwnerId: (req: Request) => Promise<string | null> | string | null,
  permissionThatOverrides: Permission,
  options: { attachAs?: string } = {},
): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const user = req.user;
      if (!user) throw new UnauthenticatedError();

      // A privileged caller short-circuits before the lookup.
      if (user.role === 'SUPER_ADMIN' || roleHasAnyPermission(user.role, [permissionThatOverrides])) {
        return next();
      }

      const ownerId = await resolveOwnerId(req);
      if (!ownerId) throw new ForbiddenError('You do not have access to this resource');
      if (ownerId !== user.id) throw new ForbiddenError('You can only access your own records');

      if (options.attachAs) (req as unknown as Record<string, unknown>)[options.attachAs] = ownerId;
      next();
    } catch (error) {
      next(error);
    }
  };
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Builds a user-facing explanation without leaking the permission matrix.
 *
 * Saying "you need event:approve_admin" tells a student the internal name of a
 * capability they cannot have. Saying "this action is limited to college admins"
 * is actionable.
 */
function describeMissing(role: Role, permissions: Permission[]): string {
  const capability = permissions[0] ?? 'this';
  const readable = capability.split(':')[1]?.replace(/_/g, ' ') ?? capability;

  const owners: Partial<Record<Permission, string>> = {
    'event:approve_admin': 'college administrators',
    'event:approve_faculty': 'faculty coordinators',
    'event:create': 'club leads, faculty and administrators',
    'certificate:issue': 'event organisers and administrators',
    'certificate:revoke': 'college administrators',
    'analytics:read_college': 'college administrators',
    'analytics:read_platform': 'platform administrators',
    'job:create': 'employers',
    'candidate:search': 'employers',
    'application:manage_status': 'employers',
    'course:manage': 'trainers and faculty',
    'project:review': 'trainers, faculty and mentors',
    'department:manage': 'college administrators',
    'audit:read': 'college administrators',
    'moderation:manage': 'platform administrators',
    'notification:broadcast': 'college administrators',
  };

  const audience = owners[capability];
  if (audience) return `This action is limited to ${audience}`;

  // Fall back to a generic message rather than naming an internal permission.
  return `Your role (${role.replace(/_/g, ' ').toLowerCase()}) cannot ${readable}`;
}

/** True when the caller holds every permission — for use inside services. */
export function callerHasAll(req: Request, permissions: Permission[]): boolean {
  const user = req.user;
  return Boolean(user && roleHasAllPermissions(user.role, permissions));
}

export function callerHasAny(req: Request, permissions: Permission[]): boolean {
  const user = req.user;
  return Boolean(user && roleHasAnyPermission(user.role, permissions));
}

export function callerIs(req: Request, ...roles: Role[]): boolean {
  return Boolean(req.user && roles.includes(req.user.role));
}

/** Marks a route as intentionally public. Throws at import time if misused. */
export function assertPublicOrGuarded(reason: string): RequestHandler {
  if (!reason || reason.length < 10) {
    throw new Error('Public routes must document why they are unauthenticated');
  }
  return (_req, _res, next) => next();
}
