import type { Request, Response } from 'express';
import type { z } from 'zod';
import { notificationSchemas } from '@campusconnect/shared';
import { prisma } from '../../config/prisma.js';
import { requireUser } from '../../middleware/auth.js';
import { auditContextOf } from '../../utils/requestContext.js';
import { ValidationError } from '../../utils/errors.js';
import { auditAction } from '../../utils/audit.js';
import {
  listNotifications,
  markRead,
  unreadCount,
  notifyMany,
} from '../../services/notifications/notification.service.js';
import { roleHasPermission } from '@campusconnect/shared';

const NOTIFICATION_CHANNELS = ['IN_APP', 'EMAIL', 'PUSH', 'WHATSAPP', 'SMS'] as const;

export async function list(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const query = req.query as z.infer<typeof notificationSchemas.notificationListQuerySchema>;

  const result = await listNotifications({
    userId: user.id,
    unreadOnly: query.unreadOnly,
    type: query.type,
    skip: (query.page - 1) * query.pageSize,
    take: query.pageSize,
  });

  res.json({
    success: true,
    data: result.items,
    // The bell badge needs the unread count regardless of the active filter.
    meta: { page: query.page, pageSize: query.pageSize, total: result.total, unreadCount: result.unreadCount },
  });
}

/** Lightweight poll for the bell badge. */
export async function countUnread(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const count = await unreadCount(user.id);
  res.json({ success: true, data: { unreadCount: count } });
}

export async function markReadHandler(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const body = req.body as z.infer<typeof notificationSchemas.markNotificationsReadSchema>;

  const updated = await markRead(user.id, {
    ids: body.ids,
    type: body.type,
    // Neither ids nor type means "mark everything".
    all: !body.ids && !body.type,
  });

  res.json({ success: true, data: { marked: updated } });
}

/* -------------------------------------------------------------------------- */
/* Preferences                                                                */
/* -------------------------------------------------------------------------- */

/** The full preference matrix, with platform defaults filled in. */
export async function getPreferences(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);

  const [setting, preferences] = await Promise.all([
    prisma.notificationSetting.findUnique({
      where: { userId: user.id },
      select: {
        emailEnabled: true,
        pushEnabled: true,
        whatsappEnabled: true,
        digestFrequency: true,
        quietHoursStart: true,
        quietHoursEnd: true,
        timezone: true,
      },
    }),
    prisma.notificationPreference.findMany({
      where: { userId: user.id },
      select: { type: true, channels: true },
    }),
  ]);

  const byType = new Map(preferences.map((p) => [p.type, p.channels]));

  res.json({
    success: true,
    data: {
      setting: setting ?? {
        emailEnabled: true,
        pushEnabled: false,
        whatsappEnabled: false,
        digestFrequency: 'INSTANT',
        quietHoursStart: null,
        quietHoursEnd: null,
        timezone: 'Asia/Kolkata',
      },
      preferences: (
        [
          'EVENT_REGISTRATION',
          'EVENT_REMINDER',
          'EVENT_UPDATED',
          'CERTIFICATE_ISSUED',
          'DEADLINE_ALERT',
          'APPLICATION_STATUS',
          'INTERVIEW_SCHEDULE',
          'JOB_MATCH',
          'CLUB_MEMBERSHIP',
          'SYSTEM',
        ] as const
      ).map((type) => ({
        type,
        channels: byType.get(type) ?? ['IN_APP'],
        // SYSTEM notifications cannot be fully muted — they carry account-critical
        // information such as security alerts.
        mutable: type !== 'SYSTEM',
      })),
      availableChannels: NOTIFICATION_CHANNELS,
    },
  });
}

export async function updatePreferences(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const body = req.body as z.infer<typeof notificationSchemas.updateNotificationPreferencesSchema>;

  // A SYSTEM preference must always include IN_APP, otherwise a security alert
  // could end up with no delivery channel at all.
  const unsafe = body.preferences.find(
    (preference) => preference.type === 'SYSTEM' && !preference.channels.includes('IN_APP'),
  );
  if (unsafe) {
    throw new ValidationError('Account and security notifications must stay enabled in-app');
  }

  await prisma.$transaction([
    prisma.notificationSetting.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        emailEnabled: body.emailEnabled ?? true,
        digestFrequency: body.digestFrequency ?? 'INSTANT',
      },
      update: {
        ...(body.emailEnabled !== undefined ? { emailEnabled: body.emailEnabled } : {}),
        ...(body.digestFrequency !== undefined ? { digestFrequency: body.digestFrequency } : {}),
      },
    }),
    ...body.preferences.map((preference) =>
      prisma.notificationPreference.upsert({
        where: { userId_type: { userId: user.id, type: preference.type } },
        create: { userId: user.id, type: preference.type, channels: preference.channels },
        update: { channels: preference.channels },
      }),
    ),
  ]);

  res.json({ success: true, data: { updated: body.preferences.length } });
}

/* -------------------------------------------------------------------------- */
/* Broadcast (college admin)                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Sends an announcement to a cohort.
 *
 * The audience is resolved server-side into a concrete user list, which is capped.
 * A broadcast to 2,000 students means 2,000 rows plus emails, so the cap and the
 * rate limiter are both load-bearing.
 */
export async function broadcast(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const body = req.body as z.infer<typeof notificationSchemas.broadcastNotificationSchema>;

  if (!user.collegeId) throw new ValidationError('Your account is not linked to a college');

  const userIds = await resolveAudience(body, user.collegeId);

  if (userIds.length === 0) {
    res.json({ success: true, data: { sent: 0, message: 'No recipients matched that audience.' } });
    return;
  }

  const { sent, failed } = await notifyMany(
    userIds,
    (userId) => ({
      userId,
      type: 'SYSTEM' as const,
      title: body.title,
      body: body.body,
      actionUrl: body.actionUrl ?? null,
      // Broadcasts honour preferences rather than forcing channels — a student who
      // muted email should not receive a mass announcement by email.
      groupKey: `broadcast-${req.requestId}`,
    }),
    { concurrency: 12 },
  );

  auditAction(auditContextOf(req), 'CREATE', 'Notification', null, {
    broadcast: true,
    audience: body.audience,
    recipients: sent,
    failed,
  });

  res.json({
    success: true,
    data: { sent, failed, message: `Delivered to ${sent} student${sent === 1 ? '' : 's'}.` },
  });
}

async function resolveAudience(
  body: z.infer<typeof notificationSchemas.broadcastNotificationSchema>,
  collegeId: string,
): Promise<string[]> {
  const baseWhere = { collegeId, deletedAt: null, status: 'ACTIVE' as const };

  switch (body.audience) {
    case 'ALL_STUDENTS': {
      const users = await prisma.user.findMany({
        where: { ...baseWhere, role: 'STUDENT' },
        select: { id: true },
        take: 5000,
      });
      return users.map((u) => u.id);
    }

    case 'DEPARTMENT': {
      if (!body.departmentId) throw new ValidationError('Select a department for this audience');
      const users = await prisma.user.findMany({
        where: { ...baseWhere, role: 'STUDENT', departmentId: body.departmentId },
        select: { id: true },
        take: 5000,
      });
      return users.map((u) => u.id);
    }

    case 'EVENT_REGISTRANTS': {
      if (!body.eventId) throw new ValidationError('Select an event for this audience');
      const registrations = await prisma.eventRegistration.findMany({
        where: {
          eventId: body.eventId,
          status: { in: ['CONFIRMED', 'ATTENDED', 'WAITLISTED'] },
        },
        select: { studentId: true },
        take: 5000,
      });
      return [...new Set(registrations.map((r) => r.studentId))];
    }

    case 'CLUB_MEMBERS': {
      if (!body.clubId) throw new ValidationError('Select a club for this audience');
      const members = await prisma.clubMembership.findMany({
        where: { clubId: body.clubId, status: 'ACTIVE', deletedAt: null },
        select: { userId: true },
        take: 5000,
      });
      return [...new Set(members.map((m) => m.userId))];
    }

    case 'CUSTOM': {
      if (!body.userIds || body.userIds.length === 0) {
        throw new ValidationError('Select at least one recipient');
      }
      // Confirm every id belongs to this college — otherwise a crafted request
      // could message students at another institution.
      const users = await prisma.user.findMany({
        where: { id: { in: body.userIds }, collegeId, deletedAt: null },
        select: { id: true },
      });
      return users.map((u) => u.id);
    }

    default:
      throw new ValidationError('Unknown audience');
  }
}

export { roleHasPermission };
