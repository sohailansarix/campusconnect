import { Router } from 'express';
import { z } from 'zod';
import { userSchemas, commonSchemas } from '@campusconnect/shared';
import * as controller from './user.controller.js';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';
import { validateBody, validateParams, validateQuery } from '../../middleware/validate.js';
import { asyncHandler } from '../../middleware/error.js';

export const userRouter = Router();

userRouter.use(authenticate);

/* -------------------------------------------------------------------------- */
/* Self                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Declared before `/:id` so "me" is never captured as an id. Express matches in
 * registration order, and a cuid-shaped `me` is not a valid cuid, so the param
 * validator would reject it — but relying on that is fragile.
 */
userRouter.get('/me', asyncHandler(controller.me));
userRouter.patch('/me', validateBody(userSchemas.updateUserSchema), asyncHandler(controller.updateMe));
userRouter.patch(
  '/me/student-profile',
  validateBody(userSchemas.updateStudentProfileSchema),
  asyncHandler(controller.updateMyProfile),
);
userRouter.post('/me/username', asyncHandler(controller.claimUsername));

/* -------------------------------------------------------------------------- */
/* Administrative                                                             */
/* -------------------------------------------------------------------------- */

userRouter.get(
  '/',
  requirePermission('user:read'),
  validateQuery(userSchemas.userListQuerySchema),
  asyncHandler(controller.list),
);

userRouter.patch(
  '/:id/status',
  requirePermission('user:update'),
  validateParams(commonSchemas.idParamSchema),
  validateBody(
    z.object({ status: z.enum(['ACTIVE', 'SUSPENDED', 'DEACTIVATED']) }),
  ),
  asyncHandler(controller.setStatus),
);

userRouter.delete(
  '/:id',
  requirePermission('user:delete'),
  validateParams(commonSchemas.idParamSchema),
  asyncHandler(controller.remove),
);

/* -------------------------------------------------------------------------- */
/* Parameterised read — must come last                                        */
/* -------------------------------------------------------------------------- */

userRouter.get(
  '/:id',
  requirePermission('user:read'),
  validateParams(commonSchemas.idParamSchema),
  asyncHandler(controller.getById),
);
