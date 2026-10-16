import { Router } from 'express';
import { certificateSchemas, commonSchemas } from '@campusconnect/shared';
import * as controller from './certificate.controller.js';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission, requireAnyPermission, assertPublicOrGuarded } from '../../middleware/rbac.js';
import { validateBody, validateParams, validateQuery } from '../../middleware/validate.js';
import { asyncHandler } from '../../middleware/error.js';
import { exportLimiter, publicReadLimiter, bulkOperationLimiter } from '../../middleware/rateLimit.js';

export const certificateRouter = Router();

/* -------------------------------------------------------------------------- */
/* Public verification                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Unauthenticated by design: the whole point of a verifiable certificate is that
 * anyone holding the printed document can confirm it. The response is a strict
 * field allowlist — see `certificateService.verifyPublic`.
 *
 * Rate limited because it is an unauthenticated endpoint that can be enumerated.
 */
certificateRouter.get(
  '/verify/:certificateId',
  assertPublicOrGuarded('Verifying a certificate must work for anyone holding the document'),
  publicReadLimiter,
  validateParams(certificateSchemas.verifyCertificateParamsSchema),
  asyncHandler(controller.verify),
);

/* -------------------------------------------------------------------------- */
/* Authenticated                                                              */
/* -------------------------------------------------------------------------- */

certificateRouter.use(authenticate);

/** A student's own certificates. */
certificateRouter.get(
  '/mine',
  validateQuery(certificateSchemas.certificateListQuerySchema),
  asyncHandler(controller.list),
);

certificateRouter.get(
  '/',
  requireAnyPermission('certificate:read', 'analytics:read_college'),
  validateQuery(certificateSchemas.certificateListQuerySchema),
  asyncHandler(controller.list),
);

certificateRouter.get(
  '/export',
  requirePermission('analytics:read_college'),
  exportLimiter,
  asyncHandler(controller.exportCertificates),
);

/* -------------------------------------------------------------------------- */
/* Issuing & revoking                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Bulk issue. Rate limited separately from other writes because a single call can
 * issue thousands of certificates and send as many emails.
 */
certificateRouter.post(
  '/issue/event',
  requirePermission('certificate:issue'),
  bulkOperationLimiter,
  validateBody(certificateSchemas.bulkIssueForEventSchema),
  asyncHandler(controller.issueForEvent),
);

certificateRouter.post(
  '/issue',
  requirePermission('certificate:issue'),
  validateBody(certificateSchemas.issueSingleCertificateSchema),
  asyncHandler(controller.issueSingle),
);

certificateRouter.post(
  '/:certificateId/revoke',
  requirePermission('certificate:revoke'),
  validateBody(certificateSchemas.revokeCertificateSchema),
  asyncHandler(controller.revoke),
);

/* -------------------------------------------------------------------------- */
/* Parameterised routes — last, so literals above win                         */
/* -------------------------------------------------------------------------- */

certificateRouter.get(
  '/:certificateId',
  validateParams(
    // The path param here is the public certificate id, not a cuid.
    certificateSchemas.verifyCertificateParamsSchema,
  ),
  asyncHandler(controller.getOne),
);

certificateRouter.get(
  '/:certificateId/download',
  validateParams(certificateSchemas.verifyCertificateParamsSchema),
  asyncHandler(controller.download),
);

export { commonSchemas };
