import { Router } from 'express';
import { z } from 'zod';
import { eventSchemas, commonSchemas } from '@campusconnect/shared';
import * as controller from './event.controller.js';
import { authenticate, optionalAuth } from '../../middleware/auth.js';
import { requirePermission, requireAnyPermission, assertPublicOrGuarded } from '../../middleware/rbac.js';
import { validateBody, validateParams, validateQuery } from '../../middleware/validate.js';
import { asyncHandler } from '../../middleware/error.js';
import { exportLimiter, publicReadLimiter } from '../../middleware/rateLimit.js';

export const eventRouter = Router();

/* -------------------------------------------------------------------------- */
/* Public discovery                                                           */
/* -------------------------------------------------------------------------- */

/**
 * `optionalAuth` rather than `authenticate`: the public events page works signed
 * out, and a signed-in visitor additionally gets their own registration state on
 * each card. This is why the route is not behind the global auth middleware.
 */
eventRouter.get(
  '/',
  assertPublicOrGuarded('Event discovery is a public marketing and student surface'),
  optionalAuth,
  publicReadLimiter,
  validateQuery(eventSchemas.eventListQuerySchema),
  asyncHandler(controller.list),
);

eventRouter.get(
  '/calendar',
  assertPublicOrGuarded('The event calendar is browsable without an account'),
  optionalAuth,
  publicReadLimiter,
  validateQuery(eventSchemas.eventCalendarQuerySchema),
  asyncHandler(controller.calendar),
);

/* -------------------------------------------------------------------------- */
/* Authenticated                                                              */
/* -------------------------------------------------------------------------- */

eventRouter.use(authenticate);

eventRouter.get('/mine/registrations', validateQuery(eventSchemas.myRegistrationQuerySchema), asyncHandler(controller.myRegistrations));

eventRouter.get(
  '/approvals/pending',
  requireAnyPermission('event:approve_faculty', 'event:approve_admin'),
  asyncHandler(controller.pendingApprovals),
);

/** Event passes are looked up by registration id, which is not an event id. */
eventRouter.get(
  '/passes/:registrationId',
  asyncHandler(controller.eventPass),
);

eventRouter.post(
  '/',
  requirePermission('event:create'),
  validateBody(eventSchemas.createEventSchema),
  asyncHandler(controller.create),
);

/* -------------------------------------------------------------------------- */
/* Single event                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Parameterised routes come last so the literal paths above are matched first.
 * Using `optionalAuth` keeps a published event readable by a signed-out visitor
 * arriving from a shared link.
 */
eventRouter.get(
  '/:id',
  assertPublicOrGuarded('A published event page is shareable without an account'),
  optionalAuth,
  asyncHandler(controller.getOne),
);

eventRouter.patch(
  '/:id',
  requirePermission('event:update'),
  validateParams(commonSchemas.idParamSchema),
  validateBody(eventSchemas.updateEventSchema),
  asyncHandler(controller.update),
);

eventRouter.post(
  '/:id/submit',
  requirePermission('event:submit'),
  validateParams(commonSchemas.idParamSchema),
  validateBody(eventSchemas.submitEventForApprovalSchema),
  asyncHandler(controller.submit),
);

eventRouter.post(
  '/:id/decide',
  requireAnyPermission('event:approve_faculty', 'event:approve_admin'),
  validateParams(commonSchemas.idParamSchema),
  validateBody(eventSchemas.eventApprovalSchema),
  asyncHandler(controller.decide),
);

eventRouter.post(
  '/:id/cancel',
  requirePermission('event:update'),
  validateParams(commonSchemas.idParamSchema),
  validateBody(z.object({ reason: z.string().trim().min(5).max(500) })),
  asyncHandler(controller.cancel),
);

/* -------------------------------------------------------------------------- */
/* Registration                                                               */
/* -------------------------------------------------------------------------- */

eventRouter.post(
  '/:id/register',
  requirePermission('event:register'),
  validateParams(commonSchemas.idParamSchema),
  validateBody(eventSchemas.registerForEventSchema),
  asyncHandler(controller.register),
);

eventRouter.get(
  '/:id/registrations',
  requirePermission('event:manage_attendance'),
  validateParams(commonSchemas.idParamSchema),
  validateQuery(eventSchemas.registrationListQuerySchema),
  asyncHandler(controller.eventRegistrations),
);

eventRouter.post(
  '/:id/registrations/manual',
  requirePermission('event:manage_attendance'),
  validateParams(commonSchemas.idParamSchema),
  validateBody(z.object({ studentId: z.string().cuid() })),
  asyncHandler(controller.manualAdd),
);

eventRouter.get(
  '/:id/registrations/export',
  requirePermission('event:view_analytics'),
  validateParams(commonSchemas.idParamSchema),
  exportLimiter,
  asyncHandler(controller.exportRegistrations),
);

/* -------------------------------------------------------------------------- */
/* Registration lifecycle (not scoped to an event id)                          */
/* -------------------------------------------------------------------------- */

eventRouter.delete(
  '/registrations/:registrationId',
  validateBody(eventSchemas.cancelRegistrationSchema),
  asyncHandler(controller.cancelRegistration),
);
