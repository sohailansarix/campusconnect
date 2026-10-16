import { Router } from 'express';
import { API_PREFIX } from '@campusconnect/shared';
import { authRouter } from './auth/auth.routes.js';
import { userRouter } from './users/user.routes.js';
import { collegeRouter } from './colleges/college.routes.js';
import { clubRouter } from './clubs/club.routes.js';
import { eventRouter } from './events/event.routes.js';
import { attendanceRouter } from './attendance/attendance.routes.js';
import { certificateRouter } from './certificates/certificate.routes.js';
import { feedbackRouter } from './feedback/feedback.routes.js';
import { notificationRouter } from './notifications/notification.routes.js';
import { analyticsRouter } from './analytics/analytics.routes.js';
import { uploadRouter } from './uploads/upload.routes.js';
import { passportRouter } from './passport/passport.routes.js';
import { databaseHealth } from '../config/prisma.js';
import { env } from '../config/env.js';

/**
 * Versioned API router.
 *
 * Every module mounts under `/api/v1`. Versioning from day one costs nothing and
 * makes the first breaking change a routing decision rather than a coordinated
 * client release.
 *
 * HTTP method and path conventions followed by every module:
 *   GET    /resource            list, paginated
 *   GET    /resource/:id        single
 *   POST   /resource            create
 *   PATCH  /resource/:id        partial update
 *   DELETE /resource/:id        soft delete
 * Nested resources read as `/events/:id/registrations`, and actions that are not
 * CRUD read as verbs (`/events/:id/submit`, `/certificates/:id/revoke`).
 */
export const apiRouter = Router();

/* -------------------------------------------------------------------------- */
/* Health                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Liveness and readiness in one endpoint.
 *
 * Checks the database rather than merely returning 200, because a process that is
 * up but cannot reach Postgres should not be sent traffic by a load balancer.
 * Returns 503 in that case.
 */
apiRouter.get('/health', async (_req, res) => {
  const database = await databaseHealth();

  const body = {
    success: database.ok,
    data: {
      status: database.ok ? 'healthy' : 'degraded',
      version: '1.0.0',
      environment: env.NODE_ENV,
      uptimeSeconds: Math.round(process.uptime()),
      checks: {
        database: { ok: database.ok, latencyMs: database.latencyMs, error: database.error },
      },
      timestamp: new Date().toISOString(),
    },
  };

  res.status(database.ok ? 200 : 503).json(body);
});

/* -------------------------------------------------------------------------- */
/* Modules                                                                    */
/* -------------------------------------------------------------------------- */

apiRouter.use('/auth', authRouter);
apiRouter.use('/users', userRouter);
apiRouter.use('/colleges', collegeRouter);
apiRouter.use('/clubs', clubRouter);
apiRouter.use('/events', eventRouter);
apiRouter.use('/attendance', attendanceRouter);
apiRouter.use('/certificates', certificateRouter);
apiRouter.use('/notifications', notificationRouter);
apiRouter.use('/analytics', analyticsRouter);
apiRouter.use('/uploads', uploadRouter);
apiRouter.use('/passport', passportRouter);

/**
 * Feedback is mounted last and at the root because its routes are event-scoped
 * (`/events/:id/feedback`) rather than living under a `/feedback` prefix. Mounting
 * it earlier would shadow nothing, but keeping it last makes the read order in
 * this file match the mental model.
 */
apiRouter.use('/', feedbackRouter);

/** Route manifest, for the docs page and for a quick sanity check in development. */
apiRouter.get('/_routes', (_req, res) => {
  res.json({
    success: true,
    data: {
      prefix: API_PREFIX,
      modules: [
        { name: 'auth', base: `${API_PREFIX}/auth`, description: 'Registration, login, refresh, password reset, invitations' },
        { name: 'users', base: `${API_PREFIX}/users`, description: 'Profiles, student profiles, account administration' },
        { name: 'colleges', base: `${API_PREFIX}/colleges`, description: 'Institutions and departments' },
        { name: 'clubs', base: `${API_PREFIX}/clubs`, description: 'Clubs, membership requests and review' },
        { name: 'events', base: `${API_PREFIX}/events`, description: 'Event lifecycle, approval chain, discovery, registration' },
        { name: 'attendance', base: `${API_PREFIX}/attendance`, description: 'QR scanning, manual check-in, live counters' },
        { name: 'certificates', base: `${API_PREFIX}/certificates`, description: 'Issuing, PDF rendering, public verification' },
        { name: 'feedback', base: `${API_PREFIX}/events/:id/feedback`, description: 'Ratings and moderation' },
        { name: 'notifications', base: `${API_PREFIX}/notifications`, description: 'Inbox, preferences, broadcasts' },
        { name: 'analytics', base: `${API_PREFIX}/analytics`, description: 'Engagement, participation, readiness, exports' },
        { name: 'uploads', base: `${API_PREFIX}/uploads`, description: 'Validated file upload and delivery' },
        { name: 'passport', base: `${API_PREFIX}/passport`, description: 'Career Passport, readiness, privacy, PDF export' },
      ],
    },
  });
});
