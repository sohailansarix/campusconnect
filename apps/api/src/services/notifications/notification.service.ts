import type { NotificationChannel, NotificationType } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { getMailer, getMessaging, getPusher } from '../mailer/index.js';
import * as templates from '../mailer/templates.js';
import type { EmailContent } from '../mailer/templates.js';

/**
 * Notification dispatch.
 *
 * One entry point — `notify()` — that:
 *   1. writes the in-app row (always; it is the source of truth),
 *   2. fans out to the user's enabled channels,
 *   3. records per-channel delivery state on the row.
 *
 * Design decisions worth knowing:
 *
 *  * **The in-app row is written first and always.** a delivery failure on email
 *    must not lose the notification — the student still sees it in the bell menu,
 *    and the row records `emailError` so support can explain what happened.
 *
 *  * **Failure never propagates.** `notify()` is called from inside
 *    registration, certificate issuance and application flows. A notification
 *    problem must never roll back the action that caused it.
 *
 *  * **`dedupeKey` makes callers idempotent.** A cron that sends event reminders
 *    can run twice without double-emailing, because the second insert hits the
 *    unique constraint and is swallowed.
 *
 *  * **Quiet hours suppress email, not the in-app row.** Suppressing the record
 *    would mean the user never learns about it; suppressing the ping is the
 *    actual intent.
 */

/* -------------------------------------------------------------------------- */
/* Defaults                                                                   */
/* -------------------------------------------------------------------------- */

/** Channels each notification type uses unless the user narrows them. */
const DEFAULT_CHANNELS: Record<NotificationType, NotificationChannel[]> = {
  EVENT_REGISTRATION: ['IN_APP', 'EMAIL'],
  EVENT_REMINDER: ['IN_APP', 'EMAIL'],
  EVENT_UPDATED: ['IN_APP', 'EMAIL'],
  CERTIFICATE_ISSUED: ['IN_APP', 'EMAIL'],
  DEADLINE_ALERT: ['IN_APP', 'EMAIL'],
  APPLICATION_STATUS: ['IN_APP', 'EMAIL'],
  INTERVIEW_SCHEDULE: ['IN_APP', 'EMAIL'],
  JOB_MATCH: ['IN_APP'],
  CLUB_MEMBERSHIP: ['IN_APP'],
  SYSTEM: ['IN_APP'],
};

/** Types a user cannot fully mute, because they carry account-critical information. */
const NON_MUTABLE_TYPES: NotificationType[] = ['SYSTEM'];

export type NotifyInput = {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  /** In-app deep link. */
  actionUrl?: string | null;
  /** Structured payload stored on the row; also used to render the email. */
  data?: Record<string, unknown> | null;
  /** Idempotency key. A second notify with the same key is a no-op. */
  dedupeKey?: string | null;
  /** Groups related notifications in the UI. */
  groupKey?: string | null;
  /**
   * Renders the email. Called only if EMAIL is in the resolved channel set, so
   * template work is skipped when the user has muted email.
   */
  email?: () => EmailContent;
  /**
   * Overrides the resolved channel set. Used by transactional flows
   * (password reset) that must always send regardless of preferences.
   */
  forceChannels?: NotificationChannel[];
  /** When true, ignores quiet hours — for genuinely urgent messages. */
  urgent?: boolean;
};

export type NotifyResult = {
  notificationId: string | null;
  /** True when a duplicate dedupeKey suppressed the send. */
  deduped: boolean;
  channelsSent: NotificationChannel[];
  channelErrors: { channel: NotificationChannel; error: string }[];
};

/* -------------------------------------------------------------------------- */
/* Dispatch                                                                   */
/* -------------------------------------------------------------------------- */

export async function notify(input: NotifyInput): Promise<NotifyResult> {
  const result: NotifyResult = {
    notificationId: null,
    deduped: false,
    channelsSent: [],
    channelErrors: [],
  };

  try {
    const channels = input.forceChannels ?? (await resolveChannels(input.userId, input.type));

    // 1. Persist the in-app row. This is the durable record.
    let notification;
    try {
      notification = await prisma.notification.create({
        data: {
          userId: input.userId,
          type: input.type,
          title: input.title,
          body: input.body,
          actionUrl: input.actionUrl ?? null,
          data: (input.data ?? undefined) as never,
          groupKey: input.groupKey ?? null,
          dedupeKey: input.dedupeKey ?? null,
          status: 'QUEUED',
        },
        select: { id: true, createdAt: true },
      });
    } catch (error) {
      // A duplicate dedupeKey is the expected path for a re-run, not a failure.
      if (isUniqueViolation(error)) {
        result.deduped = true;
        logger.debug('Notification suppressed by dedupe key', {
          userId: input.userId,
          type: input.type,
          dedupeKey: input.dedupeKey,
        });
        return result;
      }
      throw error;
    }

    result.notificationId = notification.id;

    // 2. In-app is already satisfied by the row itself.
    if (channels.includes('IN_APP')) result.channelsSent.push('IN_APP');

    // 3. Fan out to the remaining channels.
    const deliveries = await Promise.allSettled([
      channels.includes('EMAIL') && input.email
        ? sendEmail(input.userId, input.type, input.email(), { urgent: input.urgent })
        : Promise.resolve(null),
      channels.includes('PUSH') ? sendPush(input.userId, input.title, input.body, input.actionUrl) : Promise.resolve(null),
      channels.includes('WHATSAPP') ? sendWhatsApp(input.userId, input.title, input.body) : Promise.resolve(null),
      channels.includes('SMS') ? Promise.resolve(null) : Promise.resolve(null), // SMS requires DLT template registration; wired in Phase 4.
    ]);

    const channelOrder: NotificationChannel[] = ['EMAIL', 'PUSH', 'WHATSAPP', 'SMS'];
    deliveries.forEach((delivery, index) => {
      const channel = channelOrder[index]!;
      if (!channels.includes(channel)) return;

      if (delivery.status === 'fulfilled') {
        if (delivery.value !== null) result.channelsSent.push(channel);
      } else {
        result.channelErrors.push({
          channel,
          error: delivery.reason instanceof Error ? delivery.reason.message : String(delivery.reason),
        });
      }
    });

    // 4. Record the final state. A partial failure still marks the row SENT
    //    because the in-app copy is available; the failure is in metadata.
    await prisma.notification
      .update({
        where: { id: notification.id },
        data:
          result.channelErrors.length > 0
            ? {
                status: 'SENT',
                emailError: result.channelErrors.map((e) => `${e.channel}: ${e.error}`).join('; ').slice(0, 500),
              }
            : { status: 'SENT', emailedAt: channels.includes('EMAIL') && input.email ? new Date() : null },
      })
      .catch((error: unknown) => {
        logger.warn('Failed to update notification delivery state', {
          notificationId: notification.id,
          error: String(error),
        });
      });

    return result;
  } catch (error) {
    // Swallow everything. A notification failure must never break the action that
    // triggered it — see the header comment.
    logger.error('Notification dispatch failed', error, {
      userId: input.userId,
      type: input.type,
      title: input.title,
    });
    return result;
  }
}

/** Sends the same notification to many users, bounded to avoid a thundering herd. */
export async function notifyMany(
  userIds: string[],
  build: (userId: string) => NotifyInput,
  options: { concurrency?: number } = {},
): Promise<{ sent: number; failed: number }> {
  const concurrency = options.concurrency ?? 10;
  let sent = 0;
  let failed = 0;

  for (let i = 0; i < userIds.length; i += concurrency) {
    const batch = userIds.slice(i, i + concurrency);
    const results = await Promise.allSettled(batch.map((userId) => notify(build(userId))));

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value.notificationId !== null) sent += 1;
      else failed += 1;
    }
  }

  return { sent, failed };
}

/* -------------------------------------------------------------------------- */
/* Preferences                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Resolves the channel set for a user and notification type.
 *
 * Precedence: an explicit per-type preference row wins; otherwise the type's
 * default applies. `NotificationSetting.emailEnabled=false` strips EMAIL from
 * everything, which is the master switch the settings page exposes.
 */
export async function resolveChannels(
  userId: string,
  type: NotificationType,
): Promise<NotificationChannel[]> {
  const [preference, setting] = await Promise.all([
    prisma.notificationPreference.findUnique({
      where: { userId_type: { userId, type } },
      select: { channels: true },
    }),
    prisma.notificationSetting.findUnique({
      where: { userId },
      select: { emailEnabled: true, pushEnabled: true, whatsappEnabled: true },
    }),
  ]);

  let channels = preference?.channels ?? DEFAULT_CHANNELS[type] ?? ['IN_APP'];

  // Account-critical types cannot be reduced to nothing.
  if (NON_MUTABLE_TYPES.includes(type) && channels.length === 0) {
    channels = ['IN_APP'];
  }

  // In-app is always delivered — muting it would hide the notification entirely.
  if (!channels.includes('IN_APP')) channels = ['IN_APP', ...channels];

  if (setting) {
    channels = channels.filter((channel) => {
      if (channel === 'EMAIL') return setting.emailEnabled;
      if (channel === 'PUSH') return setting.pushEnabled;
      if (channel === 'WHATSAPP') return setting.whatsappEnabled;
      return true;
    });
  }

  return channels;
}

/** Creates default preference rows for a new user so the settings page has content. */
export async function seedDefaultPreferences(userId: string): Promise<void> {
  const types: NotificationType[] = [
    'EVENT_REGISTRATION',
    'EVENT_REMINDER',
    'EVENT_UPDATED',
    'CERTIFICATE_ISSUED',
    'DEADLINE_ALERT',
    'APPLICATION_STATUS',
    'INTERVIEW_SCHEDULE',
    'JOB_MATCH',
    'CLUB_MEMBERSHIP',
  ];

  await prisma.$transaction([
    prisma.notificationSetting.upsert({
      where: { userId },
      create: { userId },
      update: {},
    }),
    ...types.map((type) =>
      prisma.notificationPreference.upsert({
        where: { userId_type: { userId, type } },
        create: { userId, type, channels: DEFAULT_CHANNELS[type] ?? ['IN_APP'] },
        update: {},
      }),
    ),
  ]);
}

/* -------------------------------------------------------------------------- */
/* Channel adapters                                                           */
/* -------------------------------------------------------------------------- */

async function sendEmail(
  userId: string,
  type: NotificationType,
  content: EmailContent,
  options: { urgent?: boolean } = {},
): Promise<unknown> {
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: { email: true, fullName: true },
  });

  if (!user) return null;

  // Quiet hours: only for non-urgent mail. The in-app row already exists, so the
  // user sees it in the morning either way.
  if (!options.urgent && (await isWithinQuietHours(userId))) {
    logger.debug('Email deferred by quiet hours', { userId, type });
    return null;
  }

  const result = await getMailer().send({
    to: { name: user.fullName, address: user.email },
    subject: content.subject,
    html: content.html,
    text: content.text,
    tags: { type: type.toLowerCase() },
  });

  return result;
}

async function sendPush(
  userId: string,
  title: string,
  body: string,
  actionUrl?: string | null,
): Promise<unknown> {
  // Device tokens are not modelled until a native app exists; the stub adapter
  // records the intent. TODO(Phase 4): read tokens from a DeviceToken table.
  const tokens: string[] = [];
  if (tokens.length === 0) return null;

  return getPusher().send({
    tokens,
    title,
    body,
    data: actionUrl ? { url: actionUrl } : undefined,
  });
}

async function sendWhatsApp(userId: string, title: string, body: string): Promise<unknown> {
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: { phone: true },
  });

  if (!user?.phone) return null;

  // Normalise to E.164 without a leading plus, which Indian gateways expect.
  const to = user.phone.replace(/[^0-9]/g, '');
  return getMessaging().sendWhatsApp(to, 'campusconnect_generic', { 1: title, 2: body.slice(0, 200) });
}

/* -------------------------------------------------------------------------- */
/* Quiet hours                                                                */
/* -------------------------------------------------------------------------- */

async function isWithinQuietHours(userId: string): Promise<boolean> {
  const setting = await prisma.notificationSetting.findUnique({
    where: { userId },
    select: { quietHoursStart: true, quietHoursEnd: true, timezone: true },
  });

  if (!setting || setting.quietHoursStart === null || setting.quietHoursEnd === null) return false;

  const hourInUserTimezone = Number(
    new Intl.DateTimeFormat('en-GB', {
      hour: 'numeric',
      hour12: false,
      timeZone: setting.timezone,
    }).format(new Date()),
  );

  const { quietHoursStart: start, quietHoursEnd: end } = setting;

  // Quiet hours usually cross midnight (22 → 07), so the comparison has to wrap.
  if (start <= end) return hourInUserTimezone >= start && hourInUserTimezone < end;
  return hourInUserTimezone >= start || hourInUserTimezone < end;
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                      */
/* -------------------------------------------------------------------------- */

export async function listNotifications(params: {
  userId: string;
  unreadOnly?: boolean;
  type?: NotificationType;
  skip: number;
  take: number;
}) {
  const where = {
    userId: params.userId,
    ...(params.unreadOnly ? { readAt: null } : {}),
    ...(params.type ? { type: params.type } : {}),
  };

  const [items, total, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: params.skip,
      take: params.take,
    }),
    prisma.notification.count({ where }),
    // The bell badge needs the unread count regardless of the active filter.
    prisma.notification.count({ where: { userId: params.userId, readAt: null } }),
  ]);

  return { items, total, unreadCount };
}

export async function markRead(
  userId: string,
  options: { ids?: string[]; type?: NotificationType; all?: boolean },
): Promise<number> {
  const result = await prisma.notification.updateMany({
    where: {
      userId,
      readAt: null,
      ...(options.all
        ? {}
        : {
            ...(options.ids ? { id: { in: options.ids } } : {}),
            ...(options.type ? { type: options.type } : {}),
          }),
    },
    data: { readAt: new Date(), status: 'READ' },
  });

  return result.count;
}

export async function unreadCount(userId: string): Promise<number> {
  return prisma.notification.count({ where: { userId, readAt: null } });
}

/* -------------------------------------------------------------------------- */
/* Errors                                                                     */
/* -------------------------------------------------------------------------- */

/** Prisma P2002 — unique constraint violation, i.e. a dedupe-key collision. */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === 'P2002'
  );
}

export { templates, env };
