import { Router } from 'express';
import { uploadSchemas } from '@campusconnect/shared';
import * as controller from './upload.controller.js';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission, assertPublicOrGuarded } from '../../middleware/rbac.js';
import { validateQuery } from '../../middleware/validate.js';
import { uploadSingle } from '../../middleware/upload.js';
import { asyncHandler } from '../../middleware/error.js';
import { uploadLimiter, publicReadLimiter } from '../../middleware/rateLimit.js';

export const uploadRouter = Router();

/* -------------------------------------------------------------------------- */
/* Public asset serving                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Serves banners, logos and profile photos referenced by public pages. Only rows
 * flagged `isPublic` are served — see `upload.controller.servePublic`.
 *
 * The `*key` wildcard allows nested keys such as
 * `event_banner/2026/02/<uuid>.jpg`, which a single `:key` segment would not match.
 */
uploadRouter.get(
  '/files/*key',
  assertPublicOrGuarded('Public page assets must render without an authenticated session'),
  publicReadLimiter,
  asyncHandler(controller.servePublic),
);

/* -------------------------------------------------------------------------- */
/* Authenticated                                                              */
/* -------------------------------------------------------------------------- */

uploadRouter.use(authenticate);

/**
 * The upload endpoint. `uploadSingle` parses the multipart body, buffers the file
 * in memory and attaches the validated purpose before the controller runs.
 */
uploadRouter.post(
  '/',
  requirePermission('upload:create'),
  uploadLimiter,
  uploadSingle('file'),
  asyncHandler(controller.upload),
);

uploadRouter.get(
  '/mine',
  validateQuery(uploadSchemas.uploadListQuerySchema),
  asyncHandler(controller.listMine),
);

/** A signed URL for a private object, gated on ownership. */
uploadRouter.get('/url/*key', asyncHandler(controller.getUrl));

uploadRouter.delete('/files/*key', asyncHandler(controller.remove));
