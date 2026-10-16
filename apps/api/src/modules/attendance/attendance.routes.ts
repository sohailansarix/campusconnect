import { Router } from 'express';
import { attendanceSchemas, commonSchemas } from '@campusconnect/shared';
import * as controller from './attendance.controller.js';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';
import { validateBody, validateParams, validateQuery } from '../../middleware/validate.js';
import { asyncHandler } from '../../middleware/error.js';
import { scanLimiter, exportLimiter } from '../../middleware/rateLimit.js';

export const attendanceRouter = Router();

attendanceRouter.use(authenticate);

/* -------------------------------------------------------------------------- */
/* Scanning                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The scanner endpoint. Rate limited generously (300/min) because a busy
 * registration desk legitimately scans a few hundred passes an hour, and a
 * throttled door is a bad experience for everyone in the queue.
 */
attendanceRouter.post(
  '/scan',
  requirePermission('event:manage_attendance'),
  scanLimiter,
  validateBody(attendanceSchemas.scanPassSchema),
  asyncHandler(controller.scan),
);

attendanceRouter.post(
  '/manual',
  requirePermission('event:manage_attendance'),
  scanLimiter,
  validateBody(attendanceSchemas.manualCheckInSchema),
  asyncHandler(controller.manualCheckIn),
);

attendanceRouter.post(
  '/bulk',
  requirePermission('event:manage_attendance'),
  scanLimiter,
  validateBody(attendanceSchemas.bulkCheckInSchema),
  asyncHandler(controller.bulkCheckIn),
);

attendanceRouter.get(
  '/live',
  requirePermission('event:manage_attendance'),
  validateQuery(attendanceSchemas.attendanceLiveQuerySchema),
  asyncHandler(controller.live),
);

attendanceRouter.delete(
  '/:id',
  requirePermission('event:manage_attendance'),
  validateParams(commonSchemas.idParamSchema),
  validateBody(attendanceSchemas.revokeAttendanceSchema),
  asyncHandler(controller.revoke),
);

/* -------------------------------------------------------------------------- */
/* Reads & exports                                                            */
/* -------------------------------------------------------------------------- */

attendanceRouter.get(
  '/mine',
  validateQuery(
    // Only pagination is meaningful for a student's own history.
    commonSchemas.paginationSchema,
  ),
  asyncHandler(controller.myHistory),
);

attendanceRouter.get(
  '/',
  requirePermission('event:view_analytics'),
  validateQuery(attendanceSchemas.attendanceListQuerySchema),
  asyncHandler(controller.list),
);

attendanceRouter.get(
  '/export',
  requirePermission('event:view_analytics'),
  exportLimiter,
  asyncHandler(controller.exportReport),
);
