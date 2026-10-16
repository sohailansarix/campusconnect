import type { Request, Response } from 'express';
import type { z } from 'zod';
import { certificateSchemas, commonSchemas } from '@campusconnect/shared';
import * as certificateService from './certificate.service.js';
import { requireUser } from '../../middleware/auth.js';
import { auditContextOf } from '../../utils/requestContext.js';
import { sendCsv, csvFilename, toCsv, formatDateTime } from '../../utils/csv.js';
import { prisma } from '../../config/prisma.js';
import { roleHasPermission } from '@campusconnect/shared';

function actorOf(req: Request) {
  const user = requireUser(req);
  return {
    id: user.id,
    role: user.role,
    collegeId: user.collegeId,
    isSuperAdmin: user.role === 'SUPER_ADMIN',
  };
}

/* -------------------------------------------------------------------------- */
/* Public verification                                                        */
/* -------------------------------------------------------------------------- */

/**
 * The only unauthenticated read in the platform, and it is deliberate — see the
 * note on `certificateService.verifyPublic`. The response is a field allowlist, so
 * it cannot be widened by accident.
 */
export async function verify(req: Request, res: Response): Promise<void> {
  const { certificateId } = req.params as { certificateId: string };

  const result = await certificateService.verifyPublic(certificateId);

  /*
   * `Cache-Control` is short rather than absent: verification pages get shared
   * around, and a revoked certificate should stop appearing valid within minutes
   * rather than sitting in a CDN for a day.
   */
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.json({ success: true, data: result });
}

/* -------------------------------------------------------------------------- */
/* Issuing                                                                    */
/* -------------------------------------------------------------------------- */

export async function issueForEvent(req: Request, res: Response): Promise<void> {
  const actor = actorOf(req);
  const body = req.body as z.infer<typeof certificateSchemas.bulkIssueForEventSchema>;

  const result = await certificateService.issueForEvent(
    {
      eventId: body.eventId,
      studentIds: body.studentIds,
      position: body.position,
      sendEmail: body.sendEmail,
      reissue: body.reissue,
    },
    actor,
    auditContextOf(req),
  );

  res.status(201).json({
    success: true,
    data: {
      ...result,
      message: `${result.issued} certificate${result.issued === 1 ? '' : 's'} issued${
        result.skipped > 0 ? `, ${result.skipped} already had one` : ''
      }${result.failed.length > 0 ? `, ${result.failed.length} failed` : ''}.`,
    },
  });
}

export async function issueSingle(req: Request, res: Response): Promise<void> {
  const actor = actorOf(req);
  const body = req.body as z.infer<typeof certificateSchemas.issueSingleCertificateSchema>;

  const result = await certificateService.issueSingle(body, actor, auditContextOf(req));

  res.status(201).json({ success: true, data: result });
}

export async function revoke(req: Request, res: Response): Promise<void> {
  const actor = actorOf(req);
  const { certificateId } = req.params as { certificateId: string };
  const body = req.body as z.infer<typeof certificateSchemas.revokeCertificateSchema>;

  await certificateService.revoke(certificateId, body.reason, actor, auditContextOf(req));
  res.json({ success: true, data: { revoked: true } });
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                      */
/* -------------------------------------------------------------------------- */

export async function list(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const query = req.query as z.infer<typeof certificateSchemas.certificateListQuerySchema>;

  const result = await certificateService.list(query, {
    id: user.id,
    collegeId: user.collegeId,
    isSuperAdmin: user.role === 'SUPER_ADMIN',
  });

  res.json({ success: true, data: result.items, meta: result.meta });
}

export async function getOne(req: Request, res: Response): Promise<void> {
  const actor = actorOf(req);
  const { certificateId } = req.params as { certificateId: string };

  const certificate = await certificateService.getById(certificateId, actor);
  res.json({ success: true, data: certificate });
}

/**
 * Returns a download URL for a certificate PDF, regenerating it when the stored
 * object is missing — which happens if storage was reset or the render pass failed
 * after the row was written.
 */
export async function download(req: Request, res: Response): Promise<void> {
  const actor = actorOf(req);
  const { certificateId } = req.params as { certificateId: string };

  const certificate = await certificateService.getById(certificateId, actor);

  if (certificate.status === 'REVOKED') {
    // The PDF still exists for auditing, but a revoked certificate must not be
    // handed out as if it were valid.
    res.status(410).json({
      success: false,
      error: {
        code: 'CERTIFICATE_REVOKED',
        message: 'This certificate has been revoked and can no longer be downloaded.',
        requestId: req.requestId,
      },
    });
    return;
  }

  const url = await certificateService.ensureCertificatePdf(certificateId);
  res.json({ success: true, data: { url, certificateId } });
}

/* -------------------------------------------------------------------------- */
/* Export                                                                     */
/* -------------------------------------------------------------------------- */

export async function exportCertificates(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const query = req.query as { eventId?: string; from?: string; to?: string };

  const certificates = await prisma.certificate.findMany({
    where: {
      deletedAt: null,
      ...(user.role === 'SUPER_ADMIN' ? {} : { collegeId: user.collegeId }),
      ...(query.eventId ? { eventId: query.eventId } : {}),
      ...(query.from || query.to
        ? {
            issuedAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
    },
    orderBy: { issuedAt: 'desc' },
    take: 20_000,
    select: {
      certificateId: true,
      type: true,
      status: true,
      title: true,
      position: true,
      issuedAt: true,
      revokedAt: true,
      revokedReason: true,
      emailedAt: true,
      student: {
        select: {
          fullName: true,
          email: true,
          department: { select: { code: true } },
          studentProfile: { select: { rollNumber: true, graduationYear: true } },
        },
      },
      event: { select: { title: true, startAt: true } },
    },
  });

  const csv = toCsv(certificates, [
    { header: 'Certificate ID', value: (c) => c.certificateId },
    { header: 'Student', value: (c) => c.student.fullName },
    { header: 'Email', value: (c) => c.student.email },
    { header: 'Roll No', value: (c) => c.student.studentProfile?.rollNumber },
    { header: 'Department', value: (c) => c.student.department?.code },
    { header: 'Graduation Year', value: (c) => c.student.studentProfile?.graduationYear },
    { header: 'Title', value: (c) => c.title },
    { header: 'Type', value: (c) => c.type },
    { header: 'Position', value: (c) => c.position },
    { header: 'Status', value: (c) => c.status },
    { header: 'Event', value: (c) => c.event?.title },
    { header: 'Issued On', value: (c) => formatDateTime(c.issuedAt) },
    { header: 'Emailed On', value: (c) => formatDateTime(c.emailedAt) },
    { header: 'Revoked On', value: (c) => formatDateTime(c.revokedAt) },
    { header: 'Revoke Reason', value: (c) => c.revokedReason },
  ]);

  sendCsv(res, csv, csvFilename('certificates'));
}
