import type { Request, Response } from 'express';
import type { z } from 'zod';
import { passportSchemas } from '@campusconnect/shared';
import * as passportService from './passport.service.js';
import { requireUser } from '../../middleware/auth.js';
import { auditContextOf } from '../../utils/requestContext.js';
import { prisma } from '../../config/prisma.js';

/**
 * Passport controller.
 *
 * The public read is unauthenticated but privacy-aware: `buildPassport` receives
 * whatever viewer context exists and enforces visibility itself. A signed-out
 * visitor can only read a PUBLIC passport, and a 403 comes back with a message the
 * page renders as "this passport is private" rather than a bare error.
 */

function viewerOf(req: Request) {
  const user = req.user;
  if (!user) return null;

  return {
    id: user.id,
    role: user.role,
    collegeId: user.collegeId,
    // `employerId` on the principal is set for EMPLOYER accounts; verification is
    // re-checked in the service so a stale token cannot grant access.
    employerVerified: undefined as boolean | undefined,
  };
}

/* -------------------------------------------------------------------------- */
/* Public read                                                                */
/* -------------------------------------------------------------------------- */

export async function getByUsername(req: Request, res: Response): Promise<void> {
  const { username } = req.params as z.infer<typeof passportSchemas.passportPrivacySchema> extends never
    ? { username: string }
    : { username: string };

  const viewer = viewerOf(req);

  /*
   * Employer verification is resolved here rather than trusted from the token, so
   * a company that loses verification immediately loses access to student profiles.
   */
  if (viewer?.role === 'EMPLOYER') {
    const employer = await prisma.employerProfile.findUnique({
      where: { userId: viewer.id },
      select: { isVerified: true },
    });
    viewer.employerVerified = employer?.isVerified ?? false;
  }

  const passport = await passportService.buildPassport(username, {
    viewer,
    recordView: true,
  });

  res.json({ success: true, data: passport });
}

/** QR code and share targets. Public for a PUBLIC passport, owner-only otherwise. */
export async function share(req: Request, res: Response): Promise<void> {
  const { username } = req.params as { username: string };
  const viewer = viewerOf(req);

  // Reuse the visibility rule rather than duplicating it: if the passport is not
  // readable, neither is its share card.
  await passportService.buildPassport(username, { viewer, recordView: false });

  const result = await passportService.shareData(username, viewer?.id ?? null);
  res.json({ success: true, data: result });
}

/** PDF export. Always goes through the same visibility check. */
export async function exportPdf(req: Request, res: Response): Promise<void> {
  const { username } = req.params as { username: string };
  const viewer = viewerOf(req);

  const pdf = await passportService.exportPdf(username, { viewer });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${username}-career-passport.pdf"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(pdf);
}

/* -------------------------------------------------------------------------- */
/* Owner operations                                                           */
/* -------------------------------------------------------------------------- */

/** The caller's own passport, regardless of visibility. */
export async function getMine(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);

  const record = await prisma.user.findUnique({
    where: { id: user.id },
    select: { username: true },
  });

  if (!record?.username) {
    const { ensureUsername } = await import('../users/user.service.js');
    const username = await ensureUsername(user.id);
    const passport = await passportService.buildPassport(username, {
      viewer: { id: user.id, role: user.role, collegeId: user.collegeId },
    });
    res.json({ success: true, data: passport });
    return;
  }

  const passport = await passportService.buildPassport(record.username, {
    viewer: { id: user.id, role: user.role, collegeId: user.collegeId },
  });

  res.json({ success: true, data: passport });
}

export async function updatePrivacy(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const body = req.body as z.infer<typeof passportSchemas.passportPrivacySchema>;

  const result = await passportService.updatePrivacy(user.id, body, auditContextOf(req));

  res.json({
    success: true,
    data: {
      ...result,
      message:
        result.visibility === 'PUBLIC'
          ? 'Your passport is public. Anyone with the link can view it.'
          : result.visibility === 'EMPLOYERS_ONLY'
            ? 'Your passport is visible to verified employers you have consented to.'
            : 'Your passport is private.',
    },
  });
}

/** Readiness trend for the dashboard chart. */
export async function trend(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { days } = req.query as { days?: string };

  const result = await passportService.readinessTrend(user.id, days ? Number(days) : 90);
  res.json({ success: true, data: result });
}

/** Manual recalculation, exposed for the "refresh my score" affordance. */
export async function recalculate(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const score = await passportService.recalculateReadiness(user.id);

  res.json({
    success: true,
    data: {
      score,
      message: score === null ? 'No student profile found.' : `Readiness score updated to ${score}.`,
    },
  });
}
