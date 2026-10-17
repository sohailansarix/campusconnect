/**
 * @campusconnect/shared — public entrypoint.
 *
 * Imported by both `apps/api` (validation, RBAC) and `apps/web` (forms, nav
 * gating, display labels). Keep this barrel free of runtime dependencies beyond
 * Zod so the web bundle stays small.
 */

export * from './constants.js';
export * from './rbac.js';
export * from './types.js';

// Schemas are re-exported under namespaces to avoid collisions between, say,
// `eventListQuerySchema` and `certificateListQuerySchema` — both fine, but
// `createX` names would clash across domains.
export * as commonSchemas from './schemas/common.js';
export { AUTH_SCHEMAS as authSchemas } from './schemas/auth.js';
export * as userSchemas from './schemas/user.js';
export * as clubSchemas from './schemas/club.js';
export * as eventSchemas from './schemas/event.js';
export * as attendanceSchemas from './schemas/attendance.js';
export * as certificateSchemas from './schemas/certificate.js';
export * as feedbackSchemas from './schemas/feedback.js';
export * as notificationSchemas from './schemas/notification.js';
export * as analyticsSchemas from './schemas/analytics.js';
export * as uploadSchemas from './schemas/upload.js';
export * as passportSchemas from './schemas/passport.js';
export { UPLOAD_RULES, type UploadPurpose } from './schemas/upload.js';

export const SHARED_PACKAGE_VERSION = '1.0.0';
