import { Router } from 'express';
import { clubSchemas, commonSchemas } from '@campusconnect/shared';
import * as controller from './club.controller.js';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';
import { validateBody, validateParams, validateQuery } from '../../middleware/validate.js';
import { asyncHandler } from '../../middleware/error.js';

export const clubRouter = Router();

clubRouter.use(authenticate);

/* -------------------------------------------------------------------------- */
/* Membership review — declared before /:id so it is not shadowed             */
/* -------------------------------------------------------------------------- */

/**
 * Declared before `/:id` routes because `/memberships/...` would otherwise be
 * matched as a club id and rejected by the cuid validator.
 */
clubRouter.get(
  '/memberships/pending',
  requirePermission('club:manage_members', 'event:manage_attendance'),
  validateQuery(clubSchemas.membershipListQuerySchema),
  asyncHandler(controller.pendingRequests),
);

clubRouter.patch(
  '/memberships/:membershipId',
  requirePermission('club:manage_members', 'event:approve_faculty'),
  validateBody(clubSchemas.updateMembershipSchema),
  asyncHandler(controller.reviewMembership),
);

/* -------------------------------------------------------------------------- */
/* Collection                                                                 */
/* -------------------------------------------------------------------------- */

clubRouter.get(
  '/',
  validateQuery(clubSchemas.clubListQuerySchema),
  asyncHandler(controller.list),
);

clubRouter.post(
  '/',
  requirePermission('club:create'),
  validateBody(clubSchemas.createClubSchema),
  asyncHandler(controller.create),
);

/* -------------------------------------------------------------------------- */
/* Single club                                                                */
/* -------------------------------------------------------------------------- */

clubRouter.get(
  '/:id',
  validateParams(commonSchemas.idParamSchema),
  asyncHandler(controller.getById),
);

clubRouter.patch(
  '/:id',
  requirePermission('club:update'),
  validateParams(commonSchemas.idParamSchema),
  validateBody(clubSchemas.updateClubSchema),
  asyncHandler(controller.update),
);

clubRouter.delete(
  '/:id',
  requirePermission('club:delete'),
  validateParams(commonSchemas.idParamSchema),
  asyncHandler(controller.remove),
);

clubRouter.get(
  '/:id/members',
  validateParams(commonSchemas.idParamSchema),
  validateQuery(clubSchemas.membershipListQuerySchema),
  asyncHandler(controller.listMembers),
);

clubRouter.post(
  '/:id/join',
  requirePermission('club:join'),
  validateParams(commonSchemas.idParamSchema),
  validateBody(clubSchemas.joinClubSchema),
  asyncHandler(controller.join),
);

clubRouter.post(
  '/:id/leave',
  validateParams(commonSchemas.idParamSchema),
  asyncHandler(controller.leave),
);

clubRouter.post(
  '/:id/refresh-counters',
  requirePermission('club:update'),
  validateParams(commonSchemas.idParamSchema),
  asyncHandler(controller.refreshCounters),
);
