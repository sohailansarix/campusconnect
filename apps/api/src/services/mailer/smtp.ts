import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { formatAddress } from './console.js';
import {
  MailDeliveryError,
  type EmailAddress,
  type MailAdapter,
  type SendEmailInput,
  type SendEmailResult,
} from './types.js';

/**
 * SMTP mail adapter via Nodemailer.
 *
 * Connection pooling is enabled because the platform sends in bursts — bulk
 * certificate issuance can be 500 messages in one request, and a fresh TLS
 * handshake per message makes that unusable.
 *
 * Failures throw `MailDeliveryError`. The notification service catches it and
 * records `emailError` on the Notification row rather than failing the user's
 * action — see `modules/notifications/notification.service.ts`.
 */
export class SmtpMailAdapter implements MailAdapter {
  readonly driver = 'smtp' as const;

  private transporter: Transporter | null = null;

  private getTransporter(): Transporter {
    if (this.transporter) return this.transporter;

    if (!env.SMTP_HOST) {
      throw new MailDeliveryError('SMTP_HOST is not configured');
    }

    this.transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT ?? 587,
      secure: env.SMTP_SECURE,
      auth:
        env.SMTP_USER && env.SMTP_PASSWORD
          ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD }
          : undefined,
      pool: true,
      maxConnections: 5,
      maxMessages: 100,
      // A stalled SMTP conversation should not hold a request open indefinitely.
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });

    return this.transporter;
  }

  async send(input: SendEmailInput): Promise<SendEmailResult> {
    try {
      const info = await this.getTransporter().sendMail({
        from: formatAddress(input.from ?? env.MAIL_FROM),
        to: formatAddresses(input.to),
        cc: input.cc ? formatAddresses(input.cc) : undefined,
        bcc: input.bcc ? formatAddresses(input.bcc) : undefined,
        replyTo: input.replyTo ? formatAddress(input.replyTo) : undefined,
        subject: input.subject,
        text: input.text,
        html: input.html,
      });

      return {
        id: info.messageId,
        accepted: (info.accepted ?? []).map(addressToString),
        rejected: (info.rejected ?? []).map(addressToString),
        dryRun: false,
      };
    } catch (error) {
      logger.error('SMTP send failed', error, { subject: input.subject });
      throw new MailDeliveryError('The email could not be sent', error);
    }
  }

  async verify(): Promise<boolean> {
    try {
      await this.getTransporter().verify();
      return true;
    } catch (error) {
      logger.error('SMTP verification failed', error, { host: env.SMTP_HOST });
      return false;
    }
  }

  /** Closes pooled connections. Called on graceful shutdown. */
  close(): void {
    this.transporter?.close();
    this.transporter = null;
  }
}

function formatAddresses(to: EmailAddress | EmailAddress[]): string {
  const list = Array.isArray(to) ? to : [to];
  return list.map(formatAddress).join(', ');
}

function addressToString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'address' in value) {
    return String((value as { address: unknown }).address);
  }
  return String(value);
}
