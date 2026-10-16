import { Router } from 'express';
import { notificationSchemas, commonSchemas } from '@campusconnect/shared';
import * as controller from './notification.controller.js';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';
import { validateBody, validateQuery } from '../../middleware/validate.js';
import { asyncHandler } from '../../middleware/error.js';
import { bulkOperationLimiter } from '../../middleware/rateLimit.js';

export const notificationRouter = Router();

notificationRouter.use(authenticate);

/* -------------------------------------------------------------------------- */
/* Inbox                                                                      */
/* -------------------------------------------------------------------------- */

notificationRouter.get(
  '/',
  validateQuery(notificationSchemas.notificationListQuerySchema),
  asyncHandler(controller.list),
);

/** Polled by the bell badge. Kept cheap and separate from the list. */
notificationRouter.get('/unread-count', asyncHandler(controller.countUnread));

notificationRouter.patch(
  '/read',
  validateBody(notificationSchemas.markNotificationsReadSchema),
  asyncHandler(controller.markReadHandler),
);

/* -------------------------------------------------------------------------- */
/* Preferences                                                                */
/* -------------------------------------------------------------------------- */

notificationRouter.get('/preferences', asyncHandler(controller.getPreferences));

notificationRouter.put(
  '/preferences',
  validateBody(notificationSchemas.updateNotificationPreferencesSchema),
  asyncHandler(controller.updatePreferences),
);

/* -------------------------------------------------------------------------- */
/* Broadcast                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * College-wide announcements. Rate limited because one call can enqueue thousands
 * of notifications and emails.
 */
notificationRouter.post(
  '/broadcast',
  requirePermission('notification:broadcast'),
  bulkOperationLimiter,
  validateBody(notificationSchemas.broadcastNotificationSchema),
  asyncHandler(controller.broadcast),
);

export { commonSchemas };
