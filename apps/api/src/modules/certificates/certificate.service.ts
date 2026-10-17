import type { CertificateStatus, CertificateType, Prisma } from '@prisma/client';
import { roleHasPermission, type CertificateVerification } from '@campusconnect/shared';
import { prisma } from '../../config/prisma.js';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  assertFound,
  assertSameCollege,
} from '../../utils/errors.js';
import { buildOrderBy, normalisePagination, paginated } from '../../utils/pagination.js';
import { generateCertificateId, isValidCertificateIdFormat, sha256 } from '../../utils/ids.js';
import { generateCertificatePdf } from '../../utils/pdf.js';
import { generateQrPngBuffer } from '../../utils/qr.js';
import { auditAction, auditBulk, auditCreate, type AuditContext } from '../../utils/audit.js';
import { notifyMany } from '../../services/notifications/notification.service.js';
import * as templates from '../../services/mailer/templates.js';
import { storeCertificatePdf, certificatePdfUrl } from '../../services/storage/index.js';

/**
 * Certificate service.
 *
 * Three responsibilities:
 *
 *  1. **Issue.** Bulk for event attendees, or single for a one-off award. Issuing
 *     is idempotent per (student, event, type) — re-running a bulk issue after a
 *     partial failure must not create duplicates.
 *
 *  2. **Render.** A PDF with a QR that links to the public verification URL, so a
 *     printed certificate is checkable with a phone.
 *
 *  3. **Verify.** A public, unauthenticated lookup by certificate id.
 *
 * On the verification response: it deliberately returns *only* issuer, recipient
 * name, event/course and dates. Not the student's email, not their id, not their
 * score. A certificate id is semi-public — it is printed on a document anyone can
 * photograph — so it must not be a key to anything else in the profile.
 */

/* -------------------------------------------------------------------------- */
/* Issuing                                                                    */
/* -------------------------------------------------------------------------- */

export type IssueForEventInput = {
  eventId: string;
  studentIds?: string[];
  position?: string;
  sendEmail: boolean;
  reissue: boolean;
};

export type IssueResult = {
  issued: number;
  skipped: number;
  failed: { studentId: string; reason: string }[];
  certificateIds: string[];
};

/**
 * Issues certificates for everyone who attended an event.
 *
 * Only students with a non-revoked attendance record are eligible — a certificate
 * for someone who did not attend is the single worst failure mode this module can
 * have, so eligibility is derived from `Attendance`, never from a client-supplied
 * list of names.
 */
export async function issueForEvent(
  input: IssueForEventInput,
  actor: { id: string; role: string; collegeId: string | null; isSuperAdmin: boolean },
  context: AuditContext,
): Promise<IssueResult> {
  const event = assertFound(
    await prisma.event.findFirst({
      where: { id: input.eventId, deletedAt: null },
      select: {
        id: true,
        title: true,
        slug: true,
        collegeId: true,
        organizerId: true,
        startAt: true,
        endAt: true,
        venue: true,
        certificateEnabled: true,
        certificateTemplateId: true,
        club: { select: { presidentId: true, name: true } },
        college: { select: { name: true, logoUrl: true } },
        department: { select: { name: true } },
      },
    }),
    'Event',
  );

  await assertCanIssue(event, actor);

  if (!event.certificateEnabled) {
    throw new ConflictError('Certificates are disabled for this event. Enable them in the event settings first.');
  }

  // Eligibility is attendance, not registration — see the header note.
  const attendances = await prisma.attendance.findMany({
    where: {
      eventId: input.eventId,
      revokedAt: null,
      ...(input.studentIds && input.studentIds.length > 0
        ? { studentId: { in: input.studentIds } }
        : {}),
    },
    select: {
      id: true,
      studentId: true,
      registration: {
        select: {
          id: true,
          certificate: { select: { id: true, certificateId: true, status: true } },
        },
      },
      student: { select: { id: true, fullName: true, email: true } },
    },
  });

  if (attendances.length === 0) {
    return { issued: 0, skipped: 0, failed: [], certificateIds: [] };
  }

  const template = event.certificateTemplateId
    ? await prisma.certificateTemplate.findFirst({
        where: { id: event.certificateTemplateId, deletedAt: null },
        select: {
          id: true,
          name: true,
          bodyTemplate: true,
          primaryColor: true,
          signatoryName: true,
          signatoryTitle: true,
          signatureLabel: true,
        },
      })
    : null;

  const result: IssueResult = { issued: 0, skipped: 0, failed: [], certificateIds: [] };
  const newlyIssued: { studentId: string; certificateId: string; title: string; fullName: string }[] = [];

  for (const attendance of attendances) {
    const existing = attendance.registration.certificate;

    // Idempotency: an already-issued certificate is skipped unless reissuing.
    if (existing && existing.status === 'ISSUED' && !input.reissue) {
      result.skipped += 1;
      continue;
    }

    try {
      const certificate = await prisma.$transaction(async (tx) => {
        // Reissue revokes the old record and creates a new one, so an employer
        // holding a printed copy of the old id can be told it was replaced.
        if (existing && input.reissue) {
          await tx.certificate.update({
            where: { id: existing.id },
            data: {
              status: 'REVOKED',
              revokedAt: new Date(),
              revokedReason: 'Reissued with corrected details',
            },
          });
        }

        // Retry on the astronomically unlikely id collision.
        let created: { id: string; certificateId: string } | null = null;
        for (let attempt = 0; attempt < 5 && !created; attempt += 1) {
          const certificateId = generateCertificateId(event.endAt.getFullYear());
          try {
            created = await tx.certificate.create({
              data: {
                certificateId,
                studentId: attendance.studentId,
                collegeId: event.collegeId,
                templateId: template?.id ?? null,
                type: input.position ? 'EVENT_WINNER' : 'EVENT_PARTICIPATION',
                status: 'ISSUED',
                title: input.position
                  ? `${event.title} — ${input.position}`
                  : `Certificate of Participation — ${event.title}`,
                description: template?.bodyTemplate
                  ? renderTemplate(template.bodyTemplate, {
                      studentName: attendance.student.fullName,
                      eventTitle: event.title,
                      eventDates: formatEventDates(event.startAt, event.endAt),
                      collegeName: event.college.name,
                      departmentName: event.department?.name ?? '',
                      certificateId,
                      issuedOn: formatIssuedOn(new Date()),
                      position: input.position ?? 'Participant',
                      organizerName: event.club?.name ?? event.college.name,
                    })
                  : null,
                position: input.position ?? null,
                eventId: event.id,
                registrationId: attendance.registration.id,
                issuedById: actor.id,
                issuedAt: new Date(),
              },
              select: { id: true, certificateId: true },
            });
          } catch (error) {
            if (!isUniqueViolation(error) || attempt === 4) throw error;
            // Collision on certificateId — loop and try a fresh id.
          }
        }

        if (!created) throw new Error('Could not allocate a unique certificate id');

        return created;
      });

      result.issued += 1;
      result.certificateIds.push(certificate.certificateId);
      newlyIssued.push({
        studentId: attendance.studentId,
        certificateId: certificate.certificateId,
        title: input.position ? `${event.title} — ${input.position}` : `Certificate of Participation — ${event.title}`,
        fullName: attendance.student.fullName,
      });
    } catch (error) {
      logger.error('Certificate issuance failed for one student', error, {
        eventId: event.id,
        studentId: attendance.studentId,
      });
      result.failed.push({
        studentId: attendance.studentId,
        reason: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  // PDF rendering and email happen after the rows exist. A rendering failure leaves
  // a valid certificate with `pdfUrl = null`, which the UI regenerates on demand —
  // far better than losing the issuance record.
  if (newlyIssued.length > 0) {
    void renderAndDeliver(newlyIssued, {
      event,
      template,
      actor,
      sendEmail: input.sendEmail,
    }).catch((error: unknown) => {
      logger.error('Certificate rendering or delivery pass failed', error, { eventId: event.id });
    });
  }

  await prisma.event.update({
    where: { id: event.id },
    data: { certificateCount: { increment: result.issued } },
  });

  auditBulk(context, 'ISSUE', 'Certificate', result.certificateIds, {
    eventId: event.id,
    issued: result.issued,
    skipped: result.skipped,
    failed: result.failed.length,
    reissue: input.reissue,
  });

  return result;
}

/** Issues one certificate outside the event flow (course completion, award, etc.). */
export async function issueSingle(
  input: {
    studentId: string;
    type: CertificateType;
    eventId?: string;
    courseId?: string;
    title: string;
    description?: string;
    position?: string;
    issuedOn?: Date;
  },
  actor: { id: string; role: string; collegeId: string | null; isSuperAdmin: boolean },
  context: AuditContext,
): Promise<{ certificateId: string; id: string }> {
  const student = assertFound(
    await prisma.user.findFirst({
      where: { id: input.studentId, deletedAt: null },
      select: { id: true, fullName: true, email: true, collegeId: true },
    }),
    'Student',
  );

  if (!actor.isSuperAdmin && student.collegeId !== actor.collegeId) {
    throw new ForbiddenError('You can only issue certificates to students at your own college');
  }

  const issuedOn = input.issuedOn ?? new Date();

  const certificate = await prisma.certificate.create({
    data: {
      certificateId: generateCertificateId(issuedOn.getFullYear()),
      studentId: student.id,
      collegeId: student.collegeId ?? actor.collegeId!,
      type: input.type,
      status: 'ISSUED',
      title: input.title,
      description: input.description ?? null,
      position: input.position ?? null,
      eventId: input.eventId ?? null,
      courseId: input.courseId ?? null,
      issuedById: actor.id,
      issuedOn,
    },
    select: { id: true, certificateId: true },
  });

  auditCreate(context, 'Certificate', certificate.id, {
    certificateId: certificate.certificateId,
    studentId: student.id,
    type: input.type,
  });

  return certificate;
}

/* -------------------------------------------------------------------------- */
/* Rendering & delivery                                                       */
/* -------------------------------------------------------------------------- */

type RenderContext = {
  event: {
    id: string;
    title: string;
    startAt: Date;
    endAt: Date;
    venue: string | null;
    college: { name: string; logoUrl: string | null };
    club: { name: string } | null;
  };
  template: {
    primaryColor: string;
    signatoryName: string | null;
    signatoryTitle: string | null;
    signatureLabel: string | null;
  } | null;
  actor: { id: string };
  sendEmail: boolean;
};

async function renderAndDeliver(
  issued: { studentId: string; certificateId: string; title: string; fullName: string }[],
  context: RenderContext,
): Promise<void> {
  const verifyBase = `${env.WEB_URL}/verify`;

  for (const item of issued) {
    try {
      const verifyUrl = `${verifyBase}/${item.certificateId}`;
      const qrBuffer = await generateQrPngBuffer(verifyUrl, { width: 300 });

      const pdf = await generateCertificatePdf({
        certificateId: item.certificateId,
        title: item.title,
        recipientName: item.fullName,
        bodyText: `for participating in ${context.event.title} held on ${formatIssuedOn(context.event.startAt)}${
          context.event.venue ? ` at ${context.event.venue}` : ''
        }.`,
        collegeName: context.event.college.name,
        collegeLogoPath: null, // Remote logos are fetched separately; local paths only.
        signatoryName: context.template?.signatoryName,
        signatoryTitle: context.template?.signatoryTitle,
        signatureLabel: context.template?.signatureLabel,
        organizerName: context.event.club?.name ?? context.event.college.name,
        issuedOn: new Date(),
        primaryColor: context.template?.primaryColor ?? '#2563EB',
        verificationQr: qrBuffer,
        verificationUrl: verifyUrl,
      });

      const stored = await storeCertificatePdf(
        item.certificateId,
        pdf,
        item.studentId,
        null,
      );

      await prisma.certificate.updateMany({
        where: { certificateId: item.certificateId },
        data: {
          pdfUrl: stored.url,
          // The checksum lets a downloaded PDF be verified against the record.
          pdfChecksum: sha256(pdf),
        },
      });
    } catch (error) {
      logger.error('Certificate PDF generation failed', error, {
        certificateId: item.certificateId,
      });
    }
  }

  if (!context.sendEmail) return;

  await notifyMany(
    issued.map((i) => i.studentId),
    (studentId) => {
      const item = issued.find((i) => i.studentId === studentId)!;
      const verifyUrl = `${verifyBase}/${item.certificateId}`;

      return {
        userId: studentId,
        type: 'CERTIFICATE_ISSUED' as const,
        title: 'Your certificate is ready',
        body: `${item.title} has been issued. Certificate ID ${item.certificateId}.`,
        actionUrl: `/verify/${item.certificateId}`,
        dedupeKey: `cert-issued-${item.certificateId}`,
        email: () =>
          templates.certificateIssuedEmail({
            studentName: item.fullName,
            title: item.title,
            certificateId: item.certificateId,
            issuedOn: new Date(),
            issuerName: context.event.college.name,
            verifyUrl,
            eventTitle: context.event.title,
          }),
      };
    },
    { concurrency: 8 },
  );
}

/** Regenerates a certificate PDF when it is missing. Called from the download route. */
export async function ensureCertificatePdf(certificateId: string): Promise<string> {
  const certificate = assertFound(
    await prisma.certificate.findFirst({
      where: { certificateId, deletedAt: null },
      select: {
        id: true,
        certificateId: true,
        title: true,
        pdfUrl: true,
        status: true,
        issuedAt: true,
        position: true,
        student: { select: { id: true, fullName: true } },
        college: { select: { name: true, logoUrl: true } },
        template: {
          select: {
            primaryColor: true,
            signatoryName: true,
            signatoryTitle: true,
            signatureLabel: true,
          },
        },
        event: { select: { title: true, startAt: true, endAt: true, venue: true } },
      },
    }),
    'Certificate',
  );

  if (certificate.pdfUrl) return certificate.pdfUrl;

  const verifyUrl = `${env.WEB_URL}/verify/${certificate.certificateId}`;
  const qrBuffer = await generateQrPngBuffer(verifyUrl, { width: 300 });

  const pdf = await generateCertificatePdf({
    certificateId: certificate.certificateId,
    title: certificate.title,
    recipientName: certificate.student.fullName,
    bodyText: certificate.event
      ? `for participating in ${certificate.event.title} held on ${formatIssuedOn(certificate.event.startAt)}.`
      : certificate.title,
    collegeName: certificate.college.name,
    signatoryName: certificate.template?.signatoryName,
    signatoryTitle: certificate.template?.signatoryTitle,
    signatureLabel: certificate.template?.signatureLabel,
    issuedOn: certificate.issuedAt,
    position: certificate.position,
    primaryColor: certificate.template?.primaryColor ?? '#2563EB',
    verificationQr: qrBuffer,
    verificationUrl: verifyUrl,
  });

  const stored = await storeCertificatePdf(
    certificate.certificateId,
    pdf,
    certificate.student.id,
    null,
  );

  await prisma.certificate.update({
    where: { id: certificate.id },
    data: { pdfUrl: stored.url, pdfChecksum: sha256(pdf) },
  });

  return stored.url;
}

/* -------------------------------------------------------------------------- */
/* Public verification                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Public verification lookup.
 *
 * **This is the one endpoint in the platform with no authentication, and it is
 * intentional** — the entire value of a verifiable certificate is that a stranger
 * holding the printed document can confirm it. The compensating control is the
 * field allowlist below: the response can never be widened by adding a field to
 * the Prisma query, because it is constructed explicitly.
 */
export async function verifyPublic(certificateId: string): Promise<CertificateVerification> {
  const normalised = certificateId.trim().toUpperCase();

  if (!isValidCertificateIdFormat(normalised)) {
    // A malformed id is a 200 with `valid: false`, not a 400. The verification page
    // renders "this certificate could not be found" either way, and a 400 leaks
    // nothing extra while making the UI handle a second error shape.
    return {
      valid: false,
      certificateId: normalised,
      type: 'EVENT_PARTICIPATION',
      status: 'PENDING',
      issuedAt: null,
      recipientName: '',
      issuer: { collegeName: '' },
      verifiedAt: new Date().toISOString(),
    };
  }

  const certificate = await prisma.certificate.findFirst({
    where: { certificateId: normalised },
    select: {
      certificateId: true,
      type: true,
      status: true,
      issuedAt: true,
      revokedAt: true,
      revokedReason: true,
      position: true,
      // Only the recipient's display name is read — never email, phone or id.
      student: { select: { fullName: true } },
      college: { select: { name: true, logoUrl: true } },
      event: { select: { title: true, startAt: true, endAt: true, venue: true } },
    },
  });

  if (!certificate) {
    return {
      valid: false,
      certificateId: normalised,
      type: 'EVENT_PARTICIPATION',
      status: 'PENDING',
      issuedAt: null,
      recipientName: '',
      issuer: { collegeName: '' },
      verifiedAt: new Date().toISOString(),
    };
  }

  const revoked = certificate.status === 'REVOKED';

  /*
   * The verification response is shaped field by field rather than spread from the
   * query result. Adding a field to the `select` above cannot accidentally widen
   * what a stranger can read.
   */
  return {
    valid: certificate.status === 'ISSUED' || certificate.status === 'EXPIRED',
    certificateId: certificate.certificateId,
    type: certificate.type,
    status: certificate.status,
    issuedAt: certificate.issuedAt.toISOString(),
    recipientName: certificate.student.fullName,
    issuer: {
      collegeName: certificate.college.name,
      collegeLogoUrl: certificate.college.logoUrl,
      departmentName: null,
    },
    event: certificate.event
      ? {
          title: certificate.event.title,
          startAt: certificate.event.startAt.toISOString(),
          endAt: certificate.event.endAt.toISOString(),
          venue: certificate.event.venue,
        }
      : null,
    course: null,
    // A revocation reason is shown because a prospective employer needs to know
    // whether it was a correction or a fraud finding. Do not store anything
    // sensitive in this field.
    revokedReason: revoked ? certificate.revokedReason : null,
    verifiedAt: new Date().toISOString(),
  };
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                      */
/* -------------------------------------------------------------------------- */

export async function list(
  filters: {
    page?: number;
    pageSize?: number;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
    search?: string;
    type?: CertificateType;
    status?: CertificateStatus;
    eventId?: string;
    studentId?: string;
    collegeId?: string;
    mine?: boolean;
  },
  caller: { id: string; collegeId: string | null; isSuperAdmin: boolean },
) {
  const pagination = normalisePagination(filters);

  const where: Prisma.CertificateWhereInput = {
    deletedAt: null,
    ...(filters.mine ? { studentId: caller.id } : {}),
    ...(caller.isSuperAdmin
      ? filters.collegeId
        ? { collegeId: filters.collegeId }
        : {}
      : { collegeId: caller.collegeId }),
    ...(filters.type ? { type: filters.type } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.eventId ? { eventId: filters.eventId } : {}),
    ...(filters.studentId ? { studentId: filters.studentId } : {}),
    ...(filters.search
      ? {
          OR: [
            { certificateId: { contains: filters.search.toUpperCase() } },
            { title: { contains: filters.search, mode: 'insensitive' } },
            { student: { fullName: { contains: filters.search, mode: 'insensitive' } } },
          ],
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    prisma.certificate.findMany({
      where,
      orderBy: buildOrderBy(
        filters.sortBy,
        filters.sortOrder,
        ['issuedAt', 'certificateId', 'title'] as const,
        'issuedAt',
        'desc',
      ),
      skip: pagination.skip,
      take: pagination.take,
      select: {
        id: true,
        certificateId: true,
        type: true,
        status: true,
        title: true,
        description: true,
        position: true,
        issuedAt: true,
        pdfUrl: true,
        revokedAt: true,
        revokedReason: true,
        emailedAt: true,
        student: {
          select: {
            id: true,
            fullName: true,
            avatarUrl: true,
            username: true,
            email: true,
            department: { select: { code: true } },
            studentProfile: { select: { rollNumber: true } },
          },
        },
        event: { select: { id: true, title: true, slug: true, startAt: true, category: true } },
        college: { select: { id: true, name: true, logoUrl: true } },
        issuedBy: { select: { id: true, fullName: true, role: true } },
      },
    }),
    prisma.certificate.count({ where }),
  ]);

  return paginated(items, total, pagination);
}

export async function getById(
  certificateId: string,
  viewer: { id: string; role: string; collegeId: string | null; isSuperAdmin: boolean },
) {
  const certificate = assertFound(
    await prisma.certificate.findFirst({
      where: { certificateId },
      select: {
        id: true,
        certificateId: true,
        type: true,
        status: true,
        title: true,
        description: true,
        position: true,
        issuedAt: true,
        pdfUrl: true,
        pdfChecksum: true,
        revokedAt: true,
        revokedReason: true,
        studentId: true,
        collegeId: true,
        student: { select: { id: true, fullName: true, username: true, avatarUrl: true } },
        college: { select: { id: true, name: true, logoUrl: true } },
        event: { select: { id: true, title: true, slug: true, startAt: true, venue: true } },
      },
    }),
    'Certificate',
  );

  const isOwner = certificate.studentId === viewer.id;
  if (!isOwner && !viewer.isSuperAdmin && certificate.collegeId !== viewer.collegeId) {
    throw new ForbiddenError('This certificate belongs to another institution');
  }

  return certificate;
}

/* -------------------------------------------------------------------------- */
/* Revocation                                                                 */
/* -------------------------------------------------------------------------- */

export async function revoke(
  certificateId: string,
  reason: string,
  actor: { id: string; role: string; collegeId: string | null; isSuperAdmin: boolean },
  context: AuditContext,
): Promise<void> {
  const certificate = assertFound(
    await prisma.certificate.findFirst({
      where: { certificateId },
      select: { id: true, certificateId: true, status: true, collegeId: true, studentId: true },
    }),
    'Certificate',
  );

  assertSameCollege(certificate.collegeId, actor.collegeId);

  if (certificate.status === 'REVOKED') {
    throw new ConflictError('This certificate has already been revoked');
  }

  await prisma.certificate.update({
    where: { id: certificate.id },
    data: {
      status: 'REVOKED',
      revokedAt: new Date(),
      revokedReason: reason,
      // The PDF stays in storage so the record is auditable, but the verification
      // endpoint stops reporting it as valid.
    },
  });

  auditAction(context, 'REVOKE', 'Certificate', certificate.id, {
    certificateId: certificate.certificateId,
    reason,
    studentId: certificate.studentId,
  });

  logger.warn('Certificate revoked', {
    certificateId: certificate.certificateId,
    byUserId: actor.id,
    reason,
  });
}

/* -------------------------------------------------------------------------- */
/* Access control                                                             */
/* -------------------------------------------------------------------------- */

async function assertCanIssue(
  event: { collegeId: string; organizerId: string; club: { presidentId: string | null } | null },
  actor: { id: string; role: string; collegeId: string | null; isSuperAdmin: boolean },
): Promise<void> {
  if (actor.isSuperAdmin) return;
  if (event.collegeId !== actor.collegeId) {
    throw new ForbiddenError('That event belongs to another institution');
  }
  if (event.organizerId === actor.id) return;
  if (event.club?.presidentId === actor.id) return;
  if (roleHasPermission(actor.role as never, 'certificate:issue')) return;

  throw new ForbiddenError('You do not have permission to issue certificates for this event');
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/** Substitutes the documented `{{placeholders}}` in a template body. */
export function renderTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, key: string) => values[key] ?? '');
}

function formatEventDates(startAt: Date, endAt: Date): string {
  const formatter = new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  });

  const start = formatter.format(startAt);
  const end = formatter.format(endAt);
  return start === end ? start : `${start} – ${end}`;
}

function formatIssuedOn(date: Date): string {
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  }).format(date);
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === 'P2002'
  );
}

export { certificatePdfUrl, formatEventDates, formatIssuedOn };
