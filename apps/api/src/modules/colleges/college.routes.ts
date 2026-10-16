import { Router } from 'express';
import { z } from 'zod';
import { commonSchemas, userSchemas } from '@campusconnect/shared';
import * as controller from './college.controller.js';
import { authenticate, optionalAuth } from '../../middleware/auth.js';
import { requirePermission, assertPublicOrGuarded } from '../../middleware/rbac.js';
import { validateBody, validateParams, validateQuery } from '../../middleware/validate.js';
import { asyncHandler } from '../../middleware/error.js';
import { publicReadLimiter } from '../../middleware/rateLimit.js';

export const collegeRouter = Router();

/* -------------------------------------------------------------------------- */
/* Public                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Public because the signup form must list colleges before a user exists, and the
 * marketing site shows a college count. Only non-sensitive fields are returned —
 * see `collegeService.listPublic`. Rate limited because it is unauthenticated.
 */
collegeRouter.get(
  '/public',
  assertPublicOrGuarded('The signup form needs the college list before authentication'),
  publicReadLimiter,
  asyncHandler(controller.listPublic),
);

collegeRouter.get(
  '/:id/public',
  assertPublicOrGuarded('College landing pages are public marketing surfaces'),
  publicReadLimiter,
  validateParams(commonSchemas.idParamSchema),
  asyncHandler(controller.getPublic),
);

/* -------------------------------------------------------------------------- */
/* Platform operator                                                          */
/* -------------------------------------------------------------------------- */

collegeRouter.get(
  '/',
  authenticate,
  requirePermission('analytics:read_platform'),
  validateQuery(userSchemas.userListQuerySchema),
  asyncHandler(controller.listAll),
);

collegeRouter.post(
  '/',
  authenticate,
  requirePermission('college:create'),
  validateBody(
    z.object({
      name: z.string().trim().min(2).max(160),
      shortName: z.string().trim().max(40).optional(),
      city: z.string().trim().max(80).optional(),
      state: z.string().trim().max(80).optional(),
      website: z.string().url().max(300).optional(),
      placementEmail: z.string().email().max(160).optional(),
      placementPhone: z.string().trim().max(20).optional(),
      isPilot: z.boolean().optional(),
      departments: z
        .array(
          z.object({
            name: z.string().trim().min(2).max(120),
            code: z.string().trim().min(2).max(10),
            degree: z.string().trim().max(80).optional(),
            durationYears: z.number().int().min(1).max(6).optional(),
          }),
        )
        .max(40)
        .optional(),
    }),
  ),
  asyncHandler(controller.create),
);

/* -------------------------------------------------------------------------- */
/* College-scoped                                                             */
/* -------------------------------------------------------------------------- */

collegeRouter.use(authenticate);

collegeRouter.get('/mine', asyncHandler(controller.getMine));

collegeRouter.patch(
  '/:id',
  requirePermission('college:update'),
  validateParams(commonSchemas.idParamSchema),
  validateBody(
    z.object({
      name: z.string().trim().min(2).max(160).optional(),
      city: z.string().trim().max(80).nullable().optional(),
      state: z.string().trim().max(80).nullable().optional(),
      logoUrl: z.string().trim().max(500).nullable().optional(),
      website: z.string().url().max(300).nullable().optional(),
      placementEmail: z.string().email().max(160).nullable().optional(),
      isActive: z.boolean().optional(),
      isPilot: z.boolean().optional(),
    }),
  ),
  asyncHandler(controller.update),
);

collegeRouter.post(
  '/:id/departments',
  requirePermission('department:manage'),
  validateParams(commonSchemas.idParamSchema),
  validateBody(
    z.object({
      name: z.string().trim().min(2).max(120),
      code: z.string().trim().min(2).max(10),
      degree: z.string().trim().max(80).optional(),
      durationYears: z.number().int().min(1).max(6).optional(),
    }),
  ),
  asyncHandler(controller.createDepartment),
);

collegeRouter.patch(
  '/:id/departments/:departmentId',
  requirePermission('department:manage'),
  validateBody(
    z.object({
      name: z.string().trim().min(2).max(120).optional(),
      code: z.string().trim().min(2).max(10).optional(),
      degree: z.string().trim().max(80).nullable().optional(),
      isActive: z.boolean().optional(),
    }),
  ),
  asyncHandler(controller.updateDepartment),
);

collegeRouter.delete(
  '/:id/departments/:departmentId',
  requirePermission('department:manage'),
  asyncHandler(controller.deactivateDepartment),
);

collegeRouter.post(
  '/:id/refresh-counters',
  requirePermission('college:update'),
  validateParams(commonSchemas.idParamSchema),
  asyncHandler(controller.refreshCounters),
);

export { optionalAuth };
