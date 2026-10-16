import { env } from '../../config/env.js';
import { escapeHtml } from '../../utils/sanitize.js';

/**
 * Email templates.
 *
 * Templates are functions returning `{ subject, html, text }` rather than files on
 * disk. Three reasons: they are type-checked against their input, they cannot be
 * broken by a deployment that forgets to copy a templates directory, and every
 * template is guaranteed to ship a plain-text alternative (some clients and all
 * screen readers ignore HTML entirely).
 *
 * Style rules that matter for deliverability and accessibility:
 *  * A single column, max 600px — the only layout that renders consistently in
 *    Outlook, Gmail and Apple Mail.
 *  * Inline styles only; most clients strip <style> blocks.
 *  * Real text, not images. A certificate email whose only content is an image is
 *    unreadable with images off, which is the default for many users.
 *  * Tables for layout, because flexbox and grid are unsupported in several
 *    high-volume clients.
 */

export type EmailContent = {
  subject: string;
  html: string;
  text: string;
};

const BRAND = {
  blue: '#2563EB',
  indigo: '#4F46E5',
  slate900: '#0F172A',
  slate600: '#475569',
  slate500: '#64748B',
  border: '#E2E8F0',
  bg: '#F8FAFC',
};

/** Wraps body content in the shared shell: header, card, footer. */
function shell(options: {
  preheader: string;
  heading: string;
  bodyHtml: string;
  cta?: { label: string; url: string };
  footerNote?: string;
}): string {
  const ctaBlock = options.cta
    ? `
              <tr>
                <td style="padding: 8px 0 28px 0;">
                  <a href="${options.cta.url}"
                     style="display:inline-block;background:${BRAND.blue};color:#ffffff;text-decoration:none;
                            padding:13px 28px;border-radius:8px;font-weight:600;font-size:15px;">
                    ${escapeHtml(options.cta.label)}
                  </a>
                </td>
              </tr>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(options.heading)}</title>
</head>
<body style="margin:0;padding:0;background:${BRAND.bg};
             font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
  <!-- Preheader: shown in the inbox preview, hidden in the body. -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">
    ${escapeHtml(options.preheader)}
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.bg};padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0"
               style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;
                      border:1px solid ${BRAND.border};overflow:hidden;">

          <tr>
            <td style="padding:24px 32px;border-bottom:1px solid ${BRAND.border};">
              <span style="font-size:17px;font-weight:700;color:${BRAND.slate900};letter-spacing:-0.01em;">
                Campus<span style="color:${BRAND.blue};">Connect</span>
              </span>
            </td>
          </tr>

          <tr>
            <td style="padding:32px 32px 0 32px;">
              <h1 style="margin:0 0 16px 0;font-size:21px;line-height:1.3;font-weight:700;color:${BRAND.slate900};">
                ${escapeHtml(options.heading)}
              </h1>
            </td>
          </tr>

          <tr>
            <td style="padding:0 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="font-size:15px;line-height:1.6;color:${BRAND.slate600};">
                    ${options.bodyHtml}
                  </td>
                </tr>${ctaBlock}
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:20px 32px 28px 32px;border-top:1px solid ${BRAND.border};">
              <p style="margin:0;font-size:12px;line-height:1.6;color:${BRAND.slate500};">
                ${options.footerNote ? escapeHtml(options.footerNote) + '<br>' : ''}
                You are receiving this because you have a CampusConnect account.
                Manage what you receive in <a href="${env.WEB_URL}/dashboard/settings/notifications"
                style="color:${BRAND.slate500};">notification settings</a>.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/** Strips HTML to a readable plain-text alternative. */
function toPlainText(lines: string[], cta?: { label: string; url: string }): string {
  const parts = [...lines];
  if (cta) parts.push('', `${cta.label}: ${cta.url}`);
  parts.push('', '—', 'CampusConnect — From Campus Experience to Career Readiness');
  return parts.join('\n');
}

function formatDateTime(date: Date): string {
  return new Intl.DateTimeFormat('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  }).format(date);
}

/* -------------------------------------------------------------------------- */
/* Templates                                                                  */
/* -------------------------------------------------------------------------- */

export function eventRegistrationEmail(input: {
  studentName: string;
  eventTitle: string;
  startAt: Date;
  venue: string | null;
  mode: string;
  passUrl: string;
  organizerName: string;
}): EmailContent {
  const when = formatDateTime(input.startAt);
  const where = input.mode === 'ONLINE' ? 'Online' : (input.venue ?? 'Venue to be confirmed');

  const bodyHtml = `
    <p style="margin:0 0 16px 0;">Hi ${escapeHtml(input.studentName.split(' ')[0] ?? input.studentName)},</p>
    <p style="margin:0 0 20px 0;">You are registered for <strong style="color:${BRAND.slate900};">${escapeHtml(input.eventTitle)}</strong>.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
           style="background:${BRAND.bg};border-radius:8px;margin-bottom:20px;">
      <tr><td style="padding:16px 20px;font-size:14px;line-height:1.8;color:${BRAND.slate600};">
        <strong style="color:${BRAND.slate900};">When</strong> &nbsp;${escapeHtml(when)}<br>
        <strong style="color:${BRAND.slate900};">Where</strong> &nbsp;${escapeHtml(where)}<br>
        <strong style="color:${BRAND.slate900};">Organiser</strong> &nbsp;${escapeHtml(input.organizerName)}
      </td></tr>
    </table>
    <p style="margin:0 0 8px 0;">Your digital pass with a QR code is attached to your dashboard. Download it before the event — it works offline, so you do not need signal at the venue.</p>`;

  return {
    subject: `You're registered: ${input.eventTitle}`,
    html: shell({
      preheader: `${input.eventTitle} — ${when}`,
      heading: "You're on the list",
      bodyHtml,
      cta: { label: 'View your event pass', url: input.passUrl },
      footerNote: `A certificate will be issued automatically if you attend ${input.eventTitle}.`,
    }),
    text: toPlainText(
      [
        `Hi ${input.studentName.split(' ')[0] ?? input.studentName},`,
        '',
        `You are registered for ${input.eventTitle}.`,
        '',
        `When:    ${when}`,
        `Where:   ${where}`,
        `Organiser: ${input.organizerName}`,
        '',
        'Your digital pass with a QR code is on your dashboard. Download it before the event — it works offline.',
      ],
      { label: 'View your event pass', url: input.passUrl },
    ),
  };
}

export function eventReminderEmail(input: {
  studentName: string;
  eventTitle: string;
  startAt: Date;
  venue: string | null;
  meetingUrl: string | null;
  hoursUntil: number;
  passUrl: string;
}): EmailContent {
  const when = formatDateTime(input.startAt);
  const timing = input.hoursUntil <= 1 ? 'in under an hour' : `in about ${input.hoursUntil} hours`;

  const locationLine = input.meetingUrl
    ? `<p style="margin:0 0 20px 0;">Join link: <a href="${input.meetingUrl}" style="color:${BRAND.blue};">${escapeHtml(input.meetingUrl)}</a></p>`
    : `<p style="margin:0 0 20px 0;">Venue: <strong style="color:${BRAND.slate900};">${escapeHtml(input.venue ?? 'See event page')}</strong></p>`;

  return {
    subject: `Reminder: ${input.eventTitle} starts ${timing}`,
    html: shell({
      preheader: `${input.eventTitle} — ${when}`,
      heading: `${escapeHtml(input.eventTitle)} starts ${timing}`,
      bodyHtml: `
        <p style="margin:0 0 16px 0;">Hi ${escapeHtml(input.studentName.split(' ')[0] ?? input.studentName)},</p>
        <p style="margin:0 0 20px 0;">This is a reminder that you registered for this event.</p>
        <p style="margin:0 0 20px 0;"><strong style="color:${BRAND.slate900};">${escapeHtml(when)}</strong></p>
        ${locationLine}
        <p style="margin:0 0 8px 0;">Have your QR pass ready at the entrance to keep the queue moving.</p>`,
      cta: { label: 'Open my pass', url: input.passUrl },
    }),
    text: toPlainText(
      [
        `Hi ${input.studentName.split(' ')[0] ?? input.studentName},`,
        '',
        `Reminder: ${input.eventTitle} starts ${timing}.`,
        `When: ${when}`,
        input.meetingUrl ? `Join link: ${input.meetingUrl}` : `Venue: ${input.venue ?? 'See event page'}`,
      ],
      { label: 'Open my pass', url: input.passUrl },
    ),
  };
}

export function certificateIssuedEmail(input: {
  studentName: string;
  title: string;
  certificateId: string;
  issuedOn: Date;
  issuerName: string;
  verifyUrl: string;
  eventTitle?: string | null;
}): EmailContent {
  const issued = new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  }).format(input.issuedOn);

  const bodyHtml = `
    <p style="margin:0 0 16px 0;">Hi ${escapeHtml(input.studentName.split(' ')[0] ?? input.studentName)},</p>
    <p style="margin:0 0 20px 0;">Your certificate is ready.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
           style="background:${BRAND.bg};border-radius:8px;border-left:3px solid ${BRAND.blue};margin-bottom:20px;">
      <tr><td style="padding:18px 20px;">
        <p style="margin:0 0 6px 0;font-size:16px;font-weight:700;color:${BRAND.slate900};">
          ${escapeHtml(input.title)}
        </p>
        <p style="margin:0;font-size:13px;line-height:1.8;color:${BRAND.slate600};">
          Issued by ${escapeHtml(input.issuerName)}<br>
          Date: ${escapeHtml(issued)}<br>
          Certificate ID: <strong style="color:${BRAND.slate900};">${escapeHtml(input.certificateId)}</strong>
        </p>
      </td></tr>
    </table>
    <p style="margin:0 0 8px 0;">Anyone can verify this certificate using the link below — no login required. Add it to your Career Passport and your resume so employers can check it in one click.</p>`;

  return {
    subject: `Certificate issued: ${input.title}`,
    html: shell({
      preheader: `${input.title} — certificate ID ${input.certificateId}`,
      heading: 'Your certificate is ready',
      bodyHtml,
      cta: { label: 'View and download', url: input.verifyUrl },
      footerNote: `Keep this email — the certificate ID ${input.certificateId} is your permanent verification reference.`,
    }),
    text: toPlainText(
      [
        `Hi ${input.studentName.split(' ')[0] ?? input.studentName},`,
        '',
        'Your certificate is ready.',
        '',
        `Title:          ${input.title}`,
        `Issued by:      ${input.issuerName}`,
        `Date:           ${issued}`,
        `Certificate ID: ${input.certificateId}`,
        '',
        'Anyone can verify this certificate with the link below — no login required.',
      ],
      { label: 'View and download', url: input.verifyUrl },
    ),
  };
}

export function waitlistPromotedEmail(input: {
  studentName: string;
  eventTitle: string;
  startAt: Date;
  passUrl: string;
}): EmailContent {
  const when = formatDateTime(input.startAt);

  return {
    subject: `A seat opened up: ${input.eventTitle}`,
    html: shell({
      preheader: `You have been moved off the waitlist for ${input.eventTitle}`,
      heading: "You're off the waitlist",
      bodyHtml: `
        <p style="margin:0 0 16px 0;">Hi ${escapeHtml(input.studentName.split(' ')[0] ?? input.studentName)},</p>
        <p style="margin:0 0 20px 0;">A seat opened up for <strong style="color:${BRAND.slate900};">${escapeHtml(input.eventTitle)}</strong>
        and your registration is now confirmed.</p>
        <p style="margin:0 0 8px 0;"><strong style="color:${BRAND.slate900};">${escapeHtml(when)}</strong></p>`,
      cta: { label: 'Open my pass', url: input.passUrl },
    }),
    text: toPlainText(
      [
        `Hi ${input.studentName.split(' ')[0] ?? input.studentName},`,
        '',
        `A seat opened up for ${input.eventTitle} and your registration is now confirmed.`,
        `When: ${when}`,
      ],
      { label: 'Open my pass', url: input.passUrl },
    ),
  };
}

export function waitlistJoinedEmail(input: {
  studentName: string;
  eventTitle: string;
  position: number;
  eventUrl: string;
}): EmailContent {
  return {
    subject: `You're on the waitlist for ${input.eventTitle}`,
    html: shell({
      preheader: `Position ${input.position} on the waitlist`,
      heading: "You're on the waitlist",
      bodyHtml: `
        <p style="margin:0 0 16px 0;">Hi ${escapeHtml(input.studentName.split(' ')[0] ?? input.studentName)},</p>
        <p style="margin:0 0 20px 0;"><strong style="color:${BRAND.slate900};">${escapeHtml(input.eventTitle)}</strong>
        is currently full, so you have been added to the waitlist at position
        <strong style="color:${BRAND.blue};">${input.position}</strong>.</p>
        <p style="margin:0 0 8px 0;">If a seat frees up, you will be moved in automatically and notified by email. We recommend keeping the time free.</p>`,
      cta: { label: 'View event', url: input.eventUrl },
    }),
    text: toPlainText(
      [
        `Hi ${input.studentName.split(' ')[0] ?? input.studentName},`,
        '',
        `${input.eventTitle} is currently full. You are on the waitlist at position ${input.position}.`,
        'If a seat frees up, you will be moved in automatically and notified by email.',
      ],
      { label: 'View event', url: input.eventUrl },
    ),
  };
}

export function eventApprovalEmail(input: {
  organizerName: string;
  eventTitle: string;
  decision: 'APPROVE' | 'REJECT' | 'REQUEST_CHANGES';
  note: string | null;
  reviewerName: string;
  eventUrl: string;
}): EmailContent {
  const verb =
    input.decision === 'APPROVE' ? 'approved'
    : input.decision === 'REJECT' ? 'rejected'
    : 'sent back for changes';

  const noteBlock = input.note
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"
              style="background:${BRAND.bg};border-radius:8px;border-left:3px solid ${BRAND.blue};margin-bottom:20px;">
         <tr><td style="padding:16px 20px;font-size:14px;line-height:1.7;color:${BRAND.slate600};">
           <strong style="color:${BRAND.slate900};">Note from ${escapeHtml(input.reviewerName)}</strong><br>
           ${escapeHtml(input.note)}
         </td></tr>
       </table>`
    : '';

  return {
    subject: `${input.eventTitle} was ${verb}`,
    html: shell({
      preheader: `Decision on ${input.eventTitle}`,
      heading: `Your event was ${verb}`,
      bodyHtml: `
        <p style="margin:0 0 16px 0;">Hi ${escapeHtml(input.organizerName.split(' ')[0] ?? input.organizerName)},</p>
        <p style="margin:0 0 20px 0;"><strong style="color:${BRAND.slate900};">${escapeHtml(input.eventTitle)}</strong>
        was ${verb} by ${escapeHtml(input.reviewerName)}.</p>
        ${noteBlock}
        ${
          input.decision === 'APPROVE'
            ? '<p style="margin:0 0 8px 0;">The event is now published and visible to students, who can begin registering.</p>'
            : '<p style="margin:0 0 8px 0;">Make the requested changes and resubmit — the approval history is preserved so reviewers can see what changed.</p>'
        }`,
      cta: { label: 'Open the event', url: input.eventUrl },
    }),
    text: toPlainText(
      [
        `Hi ${input.organizerName.split(' ')[0] ?? input.organizerName},`,
        '',
        `${input.eventTitle} was ${verb} by ${input.reviewerName}.`,
        ...(input.note ? ['', `Note: ${input.note}`] : []),
      ],
      { label: 'Open the event', url: input.eventUrl },
    ),
  };
}

export function applicationStatusEmail(input: {
  studentName: string;
  jobTitle: string;
  companyName: string;
  status: string;
  statusLabel: string;
  note: string | null;
  applicationUrl: string;
}): EmailContent {
  const isOffer = input.status === 'OFFER' || input.status === 'HIRED';

  return {
    subject: `${input.companyName}: your application is now ${input.statusLabel.toLowerCase()}`,
    html: shell({
      preheader: `${input.jobTitle} at ${input.companyName} — ${input.statusLabel}`,
      heading: isOffer ? 'You have an offer' : `Application update: ${input.statusLabel}`,
      bodyHtml: `
        <p style="margin:0 0 16px 0;">Hi ${escapeHtml(input.studentName.split(' ')[0] ?? input.studentName)},</p>
        <p style="margin:0 0 20px 0;">Your application for
        <strong style="color:${BRAND.slate900};">${escapeHtml(input.jobTitle)}</strong> at
        <strong style="color:${BRAND.slate900};">${escapeHtml(input.companyName)}</strong>
        has moved to <strong style="color:${BRAND.blue};">${escapeHtml(input.statusLabel)}</strong>.</p>
        ${input.note ? `<p style="margin:0 0 20px 0;">${escapeHtml(input.note)}</p>` : ''}
        ${isOffer ? '<p style="margin:0 0 8px 0;">Open the application to review the details and respond.</p>' : ''}`,
      cta: { label: 'View application', url: input.applicationUrl },
    }),
    text: toPlainText(
      [
        `Hi ${input.studentName.split(' ')[0] ?? input.studentName},`,
        '',
        `Your application for ${input.jobTitle} at ${input.companyName} is now ${input.statusLabel}.`,
        ...(input.note ? ['', input.note] : []),
      ],
      { label: 'View application', url: input.applicationUrl },
    ),
  };
}

export function interviewScheduledEmail(input: {
  recipientName: string;
  role: 'CANDIDATE' | 'INTERVIEWER';
  jobTitle: string;
  companyName: string;
  scheduledAt: Date;
  durationMinutes: number;
  mode: string;
  meetingUrl: string | null;
  location: string | null;
  interviewerNames: string[];
  actionUrl: string;
}): EmailContent {
  const when = formatDateTime(input.scheduledAt);

  const joinLine = input.meetingUrl
    ? `Join: <a href="${input.meetingUrl}" style="color:${BRAND.blue};">${escapeHtml(input.meetingUrl)}</a>`
    : `Location: <strong style="color:${BRAND.slate900};">${escapeHtml(input.location ?? 'To be confirmed')}</strong>`;

  const participantsLine =
    input.role === 'CANDIDATE' && input.interviewerNames.length > 0
      ? `Interviewer${input.interviewerNames.length > 1 ? 's' : ''}: ${escapeHtml(input.interviewerNames.join(', '))}`
      : '';

  return {
    subject: `Interview scheduled: ${input.jobTitle} at ${input.companyName}`,
    html: shell({
      preheader: `${when} — ${input.jobTitle}`,
      heading: 'Your interview is scheduled',
      bodyHtml: `
        <p style="margin:0 0 16px 0;">Hi ${escapeHtml(input.recipientName.split(' ')[0] ?? input.recipientName)},</p>
        <p style="margin:0 0 20px 0;">Your interview for
        <strong style="color:${BRAND.slate900};">${escapeHtml(input.jobTitle)}</strong> at
        <strong style="color:${BRAND.slate900};">${escapeHtml(input.companyName)}</strong> is confirmed.</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
               style="background:${BRAND.bg};border-radius:8px;margin-bottom:20px;">
          <tr><td style="padding:16px 20px;font-size:14px;line-height:1.8;color:${BRAND.slate600};">
            <strong style="color:${BRAND.slate900};">When</strong> &nbsp;${escapeHtml(when)} (${input.durationMinutes} minutes)<br>
            <strong style="color:${BRAND.slate900};">Mode</strong> &nbsp;${escapeHtml(input.mode)}<br>
            ${joinLine}${participantsLine ? `<br>${participantsLine}` : ''}
          </td></tr>
        </table>
        ${
          input.role === 'CANDIDATE'
            ? '<p style="margin:0 0 8px 0;">Prepare with a mock interview beforehand — candidates who practise once score noticeably higher.</p>'
            : '<p style="margin:0 0 8px 0;">The candidate\'s Career Passport is attached to the application for review.</p>'
        }`,
      cta: { label: input.role === 'CANDIDATE' ? 'Prepare and confirm' : 'View candidate', url: input.actionUrl },
    }),
    text: toPlainText(
      [
        `Hi ${input.recipientName.split(' ')[0] ?? input.recipientName},`,
        '',
        `Interview for ${input.jobTitle} at ${input.companyName}`,
        `When:  ${when} (${input.durationMinutes} minutes)`,
        `Mode:  ${input.mode}`,
        input.meetingUrl ? `Join:  ${input.meetingUrl}` : `Where: ${input.location ?? 'To be confirmed'}`,
        ...(participantsLine ? ['', participantsLine] : []),
      ],
      { label: 'Open in CampusConnect', url: input.actionUrl },
    ),
  };
}

export function deadlineAlertEmail(input: {
  studentName: string;
  jobTitle: string;
  companyName: string;
  deadline: Date;
  hoursRemaining: number;
  applicationUrl: string;
}): EmailContent {
  const deadlineText = formatDateTime(input.deadline);
  const timing =
    input.hoursRemaining <= 24
      ? `${input.hoursRemaining} hour${input.hoursRemaining === 1 ? '' : 's'} left`
      : `${Math.round(input.hoursRemaining / 24)} days left`;

  return {
    subject: `${timing}: ${input.jobTitle} at ${input.companyName}`,
    html: shell({
      preheader: `Applications close ${deadlineText}`,
      heading: 'Closing soon',
      bodyHtml: `
        <p style="margin:0 0 16px 0;">Hi ${escapeHtml(input.studentName.split(' ')[0] ?? input.studentName)},</p>
        <p style="margin:0 0 20px 0;">Applications for
        <strong style="color:${BRAND.slate900};">${escapeHtml(input.jobTitle)}</strong> at
        <strong style="color:${BRAND.slate900};">${escapeHtml(input.companyName)}</strong>
        close on <strong style="color:${BRAND.blue};">${escapeHtml(deadlineText)}</strong> — ${timing}.</p>
        <p style="margin:0 0 8px 0;">Your Career Passport is attached automatically when you apply, so this takes one click.</p>`,
      cta: { label: 'Apply now', url: input.applicationUrl },
    }),
    text: toPlainText(
      [
        `Hi ${input.studentName.split(' ')[0] ?? input.studentName},`,
        '',
        `Applications for ${input.jobTitle} at ${input.companyName} close on ${deadlineText} — ${timing}.`,
      ],
      { label: 'Apply now', url: input.applicationUrl },
    ),
  };
}

export function jobMatchEmail(input: {
  studentName: string;
  jobTitle: string;
  companyName: string;
  matchScore: number;
  reasons: string[];
  jobUrl: string;
}): EmailContent {
  const reasonList = input.reasons.map((reason) => `<li style="margin-bottom:4px;">${escapeHtml(reason)}</li>`).join('');

  return {
    subject: `${input.matchScore}% match: ${input.jobTitle} at ${input.companyName}`,
    html: shell({
      preheader: `A ${input.matchScore}% match for your profile`,
      heading: 'A new role matches your profile',
      bodyHtml: `
        <p style="margin:0 0 16px 0;">Hi ${escapeHtml(input.studentName.split(' ')[0] ?? input.studentName)},</p>
        <p style="margin:0 0 16px 0;">
          <strong style="color:${BRAND.slate900};">${escapeHtml(input.jobTitle)}</strong> at
          <strong style="color:${BRAND.slate900};">${escapeHtml(input.companyName)}</strong>
          is a <strong style="color:${BRAND.blue};">${input.matchScore}% match</strong> for your passport.
        </p>
        ${reasonList ? `<ul style="margin:0 0 20px 0;padding-left:20px;color:${BRAND.slate600};font-size:14px;line-height:1.6;">${reasonList}</ul>` : ''}`,
      cta: { label: 'View this role', url: input.jobUrl },
    }),
    text: toPlainText(
      [
        `Hi ${input.studentName.split(' ')[0] ?? input.studentName},`,
        '',
        `${input.jobTitle} at ${input.companyName} is a ${input.matchScore}% match for your passport.`,
        ...(input.reasons.length > 0 ? ['', ...input.reasons.map((r) => `· ${r}`)] : []),
      ],
      { label: 'View this role', url: input.jobUrl },
    ),
  };
}

export function passwordResetEmail(input: {
  fullName: string;
  resetUrl: string;
  expiresInMinutes: number;
}): EmailContent {
  return {
    subject: 'Reset your CampusConnect password',
    html: shell({
      preheader: `This link expires in ${input.expiresInMinutes} minutes`,
      heading: 'Reset your password',
      bodyHtml: `
        <p style="margin:0 0 16px 0;">Hi ${escapeHtml(input.fullName.split(' ')[0] ?? input.fullName)},</p>
        <p style="margin:0 0 20px 0;">We received a request to reset your password. This link expires in
        <strong style="color:${BRAND.slate900};">${input.expiresInMinutes} minutes</strong> and can be used once.</p>
        <p style="margin:0 0 8px 0;font-size:13px;color:${BRAND.slate500};">
          If you did not request this, you can ignore this email — your password has not changed.
        </p>`,
      cta: { label: 'Choose a new password', url: input.resetUrl },
    }),
    text: toPlainText(
      [
        `Hi ${input.fullName.split(' ')[0] ?? input.fullName},`,
        '',
        `We received a request to reset your password. This link expires in ${input.expiresInMinutes} minutes and can be used once.`,
        '',
        'If you did not request this, you can ignore this email — your password has not changed.',
      ],
      { label: 'Choose a new password', url: input.resetUrl },
    ),
  };
}

export function welcomeEmail(input: {
  fullName: string;
  collegeName: string;
  dashboardUrl: string;
}): EmailContent {
  return {
    subject: 'Welcome to CampusConnect',
    html: shell({
      preheader: 'Your campus journey starts here',
      heading: `Welcome, ${input.fullName.split(' ')[0] ?? input.fullName}`,
      bodyHtml: `
        <p style="margin:0 0 16px 0;">Your CampusConnect account for
        <strong style="color:${BRAND.slate900};">${escapeHtml(input.collegeName)}</strong> is ready.</p>
        <p style="margin:0 0 16px 0;">Everything you do on campus now builds one continuous record — events you attend,
        certificates you earn, skills you verify, projects you ship. Your Career Passport grows with it, and employers
        see verified evidence rather than claims.</p>
        <p style="margin:0 0 8px 0;"><strong style="color:${BRAND.slate900};">Three things to do first:</strong></p>
        <ol style="margin:0 0 20px 0;padding-left:20px;color:${BRAND.slate600};font-size:14px;line-height:1.8;">
          <li>Complete your profile so recommendations are relevant.</li>
          <li>Browse upcoming events and register for one.</li>
          <li>Take a skill assessment to establish your baseline.</li>
        </ol>`,
      cta: { label: 'Go to your dashboard', url: input.dashboardUrl },
    }),
    text: toPlainText(
      [
        `Welcome, ${input.fullName.split(' ')[0] ?? input.fullName},`,
        '',
        `Your CampusConnect account for ${input.collegeName} is ready.`,
        '',
        'Three things to do first:',
        '1. Complete your profile.',
        '2. Register for an upcoming event.',
        '3. Take a skill assessment.',
      ],
      { label: 'Go to your dashboard', url: input.dashboardUrl },
    ),
  };
}

export function broadcastEmail(input: {
  title: string;
  body: string;
  actionUrl?: string | null;
}): EmailContent {
  // Broadcast bodies are plain text from an admin; converted to paragraphs rather
  // than trusted as HTML so a college admin cannot inject markup into an email.
  const paragraphs = input.body
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => `<p style="margin:0 0 14px 0;">${escapeHtml(line)}</p>`)
    .join('');

  return {
    subject: input.title,
    html: shell({
      preheader: input.body.slice(0, 120),
      heading: input.title,
      bodyHtml: paragraphs,
      ...(input.actionUrl ? { cta: { label: 'Open CampusConnect', url: input.actionUrl } } : {}),
    }),
    text: toPlainText([input.title, '', input.body], input.actionUrl ? { label: 'Open CampusConnect', url: input.actionUrl } : undefined),
  };
}
