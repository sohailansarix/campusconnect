import { Router } from 'express';
import { z } from 'zod';
import { analyticsSchemas } from '@campusconnect/shared';
import * as controller from './analytics.controller.js';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';
import { validateQuery } from '../../middleware/validate.js';
import { asyncHandler } from '../../middleware/error.js';
import { exportLimiter } from '../../middleware/rateLimit.js';

export const analyticsRouter = Router();

analyticsRouter.use(authenticate);

/**
 * Every route here requires a college-level analytics permission. A student or
 * trainer cannot reach any of them, and the service scopes each query to the
 * caller's college in addition to the route guard — belt and braces, because a
 * leaked roster is a serious incident.
 */

/* -------------------------------------------------------------------------- */
/* College dashboard                                                          */
/* -------------------------------------------------------------------------- */

analyticsRouter.get(
  '/overview',
  requirePermission('analytics:read_college'),
  validateQuery(analyticsSchemas.analyticsRangeSchema),
  asyncHandler(controller.overview),
);

analyticsRouter.get(
  '/events',
  requirePermission('analytics:read_college'),
  validateQuery(analyticsSchemas.eventAnalyticsQuerySchema),
  asyncHandler(controller.eventEngagement),
);

analyticsRouter.get(
  '/participation',
  requirePermission('analytics:read_college'),
  validateQuery(analyticsSchemas.analyticsRangeSchema),
  asyncHandler(controller.participation),
);

analyticsRouter.get(
  '/readiness',
  requirePermission('analytics:read_college'),
  validateQuery(analyticsSchemas.placementAnalyticsQuerySchema),
  asyncHandler(controller.readiness),
);

analyticsRouter.get(
  '/students',
  requirePermission('analytics:read_college'),
  validateQuery(
    analyticsSchemas.analyticsRangeSchema.extend({
      page: z.coerce.number().int().min(1).optional(),
      pageSize: z.coerce.number().int().min(1).max(100).optional(),
      search: z.string().trim().max(120).optional(),
      sortBy: z.string().trim().max(40).optional(),
      sortOrder: z.enum(['asc', 'desc']).optional(),
    }),
  ),
  asyncHandler(controller.studentEngagement),
);

/* -------------------------------------------------------------------------- */
/* Platform (super admin)                                                     */
/* -------------------------------------------------------------------------- */

analyticsRouter.get(
  '/platform',
  requirePermission('analytics:read_platform'),
  asyncHandler(controller.platform),
);

/* -------------------------------------------------------------------------- */
/* Exports                                                                    */
/* -------------------------------------------------------------------------- */

analyticsRouter.get(
  '/export',
  requirePermission('analytics:read_college'),
  exportLimiter,
  validateQuery(analyticsSchemas.exportQuerySchema),
  asyncHandler(controller.exportReport),
);
