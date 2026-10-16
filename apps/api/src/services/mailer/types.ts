/**
 * Email adapter contract.
 *
 * Two implementations: `console` (development — prints the message so you can
 * click the link) and `smtp` (Nodemailer). A push/WhatsApp/SMS adapter is stubbed
 * behind the same shape so the notification service can call one interface for
 * every channel.
 */

export type EmailAddress = string | { name: string; address: string };

export type SendEmailInput = {
  to: EmailAddress | EmailAddress[];
  subject: string;
  /** Plain-text alternative. Always provided — some clients and all screen
   *  readers prefer it, and it is what shows in a notification preview. */
  text: string;
  /** Rendered HTML. */
  html: string;
  replyTo?: EmailAddress;
  cc?: EmailAddress[];
  bcc?: EmailAddress[];
  /** Tags for provider-side analytics (e.g. `type:certificate_issued`). */
  tags?: Record<string, string>;
  /** Overrides the default from address, for college-branded mail. */
  from?: EmailAddress;
};

export type SendEmailResult = {
  /** Provider message id, or a synthetic one for the console adapter. */
  id: string;
  accepted: string[];
  rejected: string[];
  /** True when the adapter only logged rather than sent. */
  dryRun: boolean;
};

export interface MailAdapter {
  readonly driver: 'console' | 'smtp';
  send(input: SendEmailInput): Promise<SendEmailResult>;
  /** Confirms the transport is usable — called at boot in production. */
  verify(): Promise<boolean>;
}

/* -------------------------------------------------------------------------- */
/* Push / SMS / WhatsApp                                                      */
/* -------------------------------------------------------------------------- */

export type PushMessage = {
  /** Device tokens or a user id the provider resolves. */
  tokens: string[];
  title: string;
  body: string;
  data?: Record<string, string>;
};

export type SmsMessage = {
  /** E.164 without the leading `+`, which is what most Indian gateways expect. */
  to: string;
  body: string;
  /** DLT template id — required for transactional SMS in India. */
  templateId?: string;
};

export interface PushAdapter {
  readonly driver: 'stub' | 'fcm' | 'expo';
  send(message: PushMessage): Promise<{ sent: number; failed: number }>;
}

export interface MessagingAdapter {
  readonly driver: 'stub' | 'twilio' | 'gupshup';
  /** WhatsApp template message. */
  sendWhatsApp(to: string, template: string, variables: Record<string, string>): Promise<{ id: string }>;
  sendSms(message: SmsMessage): Promise<{ id: string }>;
}

/** Thrown when an adapter is configured but misconfigured at send time. */
export class MailDeliveryError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'MailDeliveryError';
  }
}
