import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { ConsoleMailAdapter } from './console.js';
import { SmtpMailAdapter } from './smtp.js';
import type { MailAdapter, PushAdapter, MessagingAdapter, SmsMessage } from './types.js';

/**
 * Notification channel facade.
 *
 * The notification service calls `getMailer().send(...)` and never knows which
 * transport is live. Push and WhatsApp/SMS are stubs in Phase 1: they log what
 * they *would* have sent and return success, so the calling code paths are real
 * and testing them does not require provider credentials.
 *
 * TODO(Phase 4): implement `FcmPushAdapter` and `TwilioMessagingAdapter` behind
 * these same interfaces and switch on `PUSH_DRIVER` / `WHATSAPP_DRIVER`.
 */

let mailer: MailAdapter | null = null;
let pusher: PushAdapter | null = null;
let messaging: MessagingAdapter | null = null;

export function getMailer(): MailAdapter {
  if (mailer) return mailer;
  mailer = env.MAIL_DRIVER === 'smtp' ? new SmtpMailAdapter() : new ConsoleMailAdapter();
  return mailer;
}

export function setMailer(next: MailAdapter | null): void {
  mailer = next;
}

/** Boot-time transport check. Logs loudly rather than crashing — mail is not
 *  essential to the API serving requests, and a wrong SMTP password should not
 *  take the platform down. */
export async function verifyMailer(): Promise<void> {
  const current = getMailer();
  const ok = await current.verify();
  if (!ok) {
    logger.error('Mail transport could not be verified — outbound email may fail', undefined, {
      driver: current.driver,
    });
  }
}

/* -------------------------------------------------------------------------- */
/* Push (stub)                                                                */
/* -------------------------------------------------------------------------- */

class StubPushAdapter implements PushAdapter {
  readonly driver = 'stub' as const;

  async send(message: { tokens: string[]; title: string; body: string }): Promise<{ sent: number; failed: number }> {
    // TODO(Phase 4): replace with FCM/Expo. Until then this records intent so the
    // call sites and the data model are exercised in development.
    logger.debug('[push stub] would deliver notification', {
      tokens: message.tokens.length,
      title: message.title,
    });
    return { sent: message.tokens.length, failed: 0 };
  }
}

export function getPusher(): PushAdapter {
  pusher ??= new StubPushAdapter();
  return pusher;
}

/* -------------------------------------------------------------------------- */
/* WhatsApp / SMS (stub)                                                      */
/* -------------------------------------------------------------------------- */

class StubMessagingAdapter implements MessagingAdapter {
  readonly driver = 'stub' as const;

  async sendWhatsApp(to: string, template: string, variables: Record<string, string>): Promise<{ id: string }> {
    // TODO(Phase 4): wire a BSP (Gupshup/Twilio/Interakt). Note that in India
    // WhatsApp business messages must use pre-approved templates, so `template`
    // here is a template *name*, not free text.
    logger.debug('[whatsapp stub] would send template message', { to, template, variables });
    return { id: `stub-wa-${Date.now()}` };
  }

  async sendSms(message: SmsMessage): Promise<{ id: string }> {
    // TODO(Phase 4): wire an Indian DLT-registered gateway. `templateId` is a
    // regulatory requirement, not a preference, for transactional SMS.
    logger.debug('[sms stub] would send message', { to: message.to, templateId: message.templateId });
    return { id: `stub-sms-${Date.now()}` };
  }
}

export function getMessaging(): MessagingAdapter {
  messaging ??= new StubMessagingAdapter();
  return messaging;
}

/** Closes the SMTP pool on shutdown. Safe to call when the console adapter is live. */
export function closeMailer(): void {
  if (mailer instanceof SmtpMailAdapter) mailer.close();
}

export * from './types.js';
export { ConsoleMailAdapter, SmtpMailAdapter };
