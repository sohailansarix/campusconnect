import { randomUUID } from 'node:crypto';
import type { EmailAddress, MailAdapter, SendEmailInput, SendEmailResult } from './types.js';
import { logger } from '../../config/logger.js';

/**
 * Console mail adapter — the development default.
 *
 * Deliberately verbose: it prints the recipient, subject and a plain-text body so
 * a developer testing certificate issuance or password reset can copy the link
 * straight out of the terminal.
 *
 * It never throws. A registration must succeed even if the confirmation email
 * "fails", so the contract for every adapter is: report problems through the
 * result and the log, and let the caller decide.
 */
export class ConsoleMailAdapter implements MailAdapter {
  readonly driver = 'console' as const;

  async send(input: SendEmailInput): Promise<SendEmailResult> {
    const recipients = normaliseRecipients(input.to);
    const id = `console-${randomUUID()}`;

    const divider = '─'.repeat(72);
    const banner = [
      '',
      divider,
      `✉  EMAIL (console adapter — nothing was actually sent)`,
      `   To:      ${recipients.join(', ')}`,
      `   Subject: ${input.subject}`,
      divider,
      input.text.trim(),
      divider,
      '',
    ].join('\n');

    // Written to stdout rather than through the structured logger so the body is
    // readable rather than JSON-escaped into one line.
    process.stdout.write(banner);

    logger.debug('Console email rendered', { id, recipients, subject: input.subject });

    return { id, accepted: recipients, rejected: [], dryRun: true };
  }

  async verify(): Promise<boolean> {
    return true;
  }
}

export function normaliseRecipients(to: EmailAddress | EmailAddress[]): string[] {
  const list = Array.isArray(to) ? to : [to];
  return list.map((entry) => (typeof entry === 'string' ? entry : entry.address));
}

export function formatAddress(address: EmailAddress): string {
  return typeof address === 'string' ? address : `${address.name} <${address.address}>`;
}
