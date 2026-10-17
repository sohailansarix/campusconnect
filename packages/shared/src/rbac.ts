/**
 * RBAC — the single source of truth for permissions.
 *
 * The API enforces this in `requirePermission()` middleware; the web app imports
 * the same matrix to decide which nav items and routes to render. Roles are
 * code-defined (not database rows) because they change with deploys, not with
 * user data — see the note in `apps/api/prisma/schema.prisma` above the User model.
 *
 * Never gate a destructive action on the UI alone. Every route handler that
 * mutates state must declare the permission it needs.
 */

import type { Role } from './constants.js';

export const PERMISSIONS = [
  // Users & institutions
  'user:read',
  'user:create',
  'user:update',
  'user:delete',
  'college:read',
  'college:create',
  'college:update',
  'department:manage',
  'club:read',
  'club:create',
  'club:update',
  'club:delete',
  'club:join',
  'club:manage_members',

  // Events
  'event:read',
  'event:create',
  'event:update',
  'event:delete',
  'event:submit',
  'event:approve_faculty',
  'event:approve_admin',
  'event:register',
  'event:manage_attendance',
  'event:view_analytics',

  // Certificates & feedback
  'certificate:read',
  'certificate:issue',
  'certificate:revoke',
  'feedback:create',
  'feedback:read',

  // Notifications
  'notification:read',
  'notification:manage_preferences',
  'notification:broadcast',

  // Analytics
  'analytics:read_college',
  'analytics:read_employer',
  'analytics:read_platform',

  // SkillBridge
  'assessment:take',
  'assessment:manage',
  'course:read',
  'course:create',
  'course:manage',
  'course:enroll',
  'project:submit',
  'project:review',
  'internship:read',
  'internship:create',
  'internship:apply',
  'mentor:session_book',

  // CareerConnect
  'job:read',
  'job:create',
  'job:update',
  'job:apply',
  'application:read_own',
  'application:read_employer',
  'application:manage_status',
  'candidate:search',
  'interview:schedule',
  'interview:conduct',

  // Passport / resume / files
  'passport:read_own',
  'passport:manage_privacy',
  'resume:manage',
  'upload:create',

  // Platform
  'subscription:manage',
  'payment:manage',
  'audit:read',
  'moderation:manage',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/** Wildcard — SUPER_ADMIN holds every permission without enumerating them. */
export const WILDCARD = '*' as const;

/**
 * Baseline permissions every authenticated user has, regardless of role.
 * Keep this list small: it should only contain things that apply to literally
 * everyone (reading public catalogue data, managing their own notifications).
 */
const BASE_PERMISSIONS: Permission[] = [
  'event:read',
  'club:read',
  'college:read',
  'certificate:read',
  'course:read',
  'internship:read',
  'job:read',
  'notification:read',
  'notification:manage_preferences',
  'upload:create',
];

const STUDENT_PERMISSIONS: Permission[] = [
  ...BASE_PERMISSIONS,
  'event:register',
  'club:join',
  'feedback:create',
  'assessment:take',
  'course:enroll',
  'project:submit',
  'internship:apply',
  'job:apply',
  'application:read_own',
  'mentor:session_book',
  'passport:read_own',
  'passport:manage_privacy',
  'resume:manage',
  'user:update',
];

export const ROLE_PERMISSIONS: Record<Role, Permission[] | typeof WILDCARD> = {
  STUDENT: STUDENT_PERMISSIONS,

  // Club leads keep the full student capability set and add club-scoped powers.
  CLUB_LEAD: [
    ...STUDENT_PERMISSIONS,
    'club:update',
    'club:manage_members',
    'event:create',
    'event:update',
    'event:submit',
    'event:manage_attendance',
    'event:view_analytics',
    'certificate:issue',
  ],

  FACULTY_COORDINATOR: [
    ...BASE_PERMISSIONS,
    'event:create',
    'event:update',
    'event:submit',
    'event:approve_faculty',
    'event:manage_attendance',
    'event:view_analytics',
    'certificate:issue',
    'certificate:revoke',
    'feedback:read',
    'analytics:read_college',
    'course:create',
    'course:manage',
    'project:review',
    'interview:conduct',
    'assessment:manage',
    'user:read',
    'club:create',
    'club:update',
    'club:manage_members',
  ],

  COLLEGE_ADMIN: [
    ...BASE_PERMISSIONS,
    'user:read',
    'user:create',
    'user:update',
    'user:delete',
    'college:update',
    'department:manage',
    'club:create',
    'club:update',
    'club:delete',
    'club:manage_members',
    'event:create',
    'event:update',
    'event:delete',
    'event:submit',
    'event:approve_faculty',
    'event:approve_admin',
    'event:manage_attendance',
    'event:view_analytics',
    'certificate:issue',
    'certificate:revoke',
    'feedback:read',
    'notification:broadcast',
    'analytics:read_college',
    'assessment:manage',
    'course:create',
    'course:manage',
    'project:review',
    'internship:create',
    'interview:conduct',
    'application:read_employer',
    'audit:read',
    'subscription:manage',
  ],

  TRAINER: [
    ...BASE_PERMISSIONS,
    'event:create',
    'event:update',
    'event:submit',
    'event:manage_attendance',
    'event:view_analytics',
    'certificate:issue',
    'feedback:read',
    'assessment:manage',
    'course:create',
    'course:manage',
    'project:review',
    'interview:conduct',
    'user:read',
    'analytics:read_college',
  ],

  EMPLOYER: [
    ...BASE_PERMISSIONS,
    'user:update',
    'job:create',
    'job:update',
    'internship:create',
    'application:read_employer',
    'application:manage_status',
    'candidate:search',
    'interview:schedule',
    'analytics:read_employer',
    'subscription:manage',
    'payment:manage',
  ],

  SUPER_ADMIN: WILDCARD,
};

/** Expand a role into a concrete permission set (resolving the wildcard). */
export function permissionsForRole(role: Role): readonly Permission[] {
  const granted = ROLE_PERMISSIONS[role];
  return granted === WILDCARD ? PERMISSIONS : granted;
}

/** True when `role` holds `permission`. */
export function roleHasPermission(role: Role, permission: Permission): boolean {
  const granted = ROLE_PERMISSIONS[role];
  if (granted === WILDCARD) return true;
  return granted.includes(permission);
}

/** True when the role holds every permission in `required`. */
export function roleHasAllPermissions(role: Role, required: readonly Permission[]): boolean {
  return required.every((p) => roleHasPermission(role, p));
}

/** True when the role holds at least one of `required`. */
export function roleHasAnyPermission(role: Role, required: readonly Permission[]): boolean {
  return required.some((p) => roleHasPermission(role, p));
}

/** Which dashboard route a role lands on after login. */
export const ROLE_HOME: Record<Role, string> = {
  STUDENT: '/dashboard',
  CLUB_LEAD: '/dashboard/organizer',
  FACULTY_COORDINATOR: '/dashboard/organizer',
  COLLEGE_ADMIN: '/dashboard/college',
  TRAINER: '/dashboard/mentor',
  EMPLOYER: '/dashboard/employer',
  SUPER_ADMIN: '/dashboard/admin',
};
