import { roleHasPermission, type Role } from '@campusconnect/shared';

/**
 * Event-specific permission helpers.
 *
 * These live outside the controller so both the controller and the service layer
 * can ask the same question. Duplicating a role check in two places is how the UI
 * and the API drift apart.
 */

/**
 * True when the role participates in the approval chain, and therefore may also
 * see unapproved events in listings.
 *
 * Deliberately broader than the approve permission: a college admin can *see*
 * every draft in their college, and a trainer can see drafts they are mentoring on
 * even though they cannot approve them.
 */
export function controllerHasReviewRights(role: Role): boolean {
  return (
    roleHasPermission(role, 'event:approve_faculty') ||
    roleHasPermission(role, 'event:approve_admin') ||
    roleHasPermission(role, 'event:view_analytics')
  );
}

/** True when the role may create events at all. */
export function canCreateEvents(role: Role): boolean {
  return roleHasPermission(role, 'event:create');
}

/**
 * True when the role may publish without going through the full chain.
 *
 * Only college admins. A faculty coordinator still needs admin sign-off, which is
 * the point of having two stages.
 */
export function canPublishDirectly(role: Role): boolean {
  return role === 'COLLEGE_ADMIN' || role === 'SUPER_ADMIN';
}

/** Roles that may scan attendance at the door. */
export function canScanAttendance(role: Role): boolean {
  return roleHasPermission(role, 'event:manage_attendance');
}
