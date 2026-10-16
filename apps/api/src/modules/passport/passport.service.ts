import type { PassportDto, PassportVisibility, ProficiencyLevel } from '@campusconnect/shared';
import { readinessBand, roleHasPermission } from '@campusconnect/shared';
import { prisma } from '../../config/prisma.js';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { ForbiddenError, NotFoundError, assertFound } from '../../utils/errors.js';
import { auditAction, type AuditContext } from '../../utils/audit.js';
import { calculateReadiness, proficiencyForScore } from '../../services/ai/readiness.service.js';
import type { ReadinessInput } from '../../services/ai/types.js';
import { generateQrDataUrl } from '../../utils/qr.js';
import { generateResumePdf, type ResumePdfInput } from '../../utils/pdf.js';

/**
 * Student Career Passport — the platform's centrepiece.
 *
 * The passport is a **read model assembled from many tables**, never a stored
 * document. That is a deliberate choice with real consequences:
 *
 *  * A certificate earned this morning appears immediately, with no sync job and no
 *    chance of the passport and the certificate list disagreeing.
 *  * The cost is a multi-query read. At the pilot's scale that is fine; the caching
 *    seam is `PASSPORT_CACHE_TTL` below, unused today.
 *
 * Readiness is recomputed on every write that could change it (attendance, project
 * approval, interview feedback) via `recalculateReadiness`, and the result is
 * persisted on `StudentProfile` so employer search can filter and sort on it. The
 * *breakdown* is recomputed on read, so the numbers on screen always reconcile with
 * the evidence list beside them.
 *
 * TODO(AI): `suggestions` comes from the rule-based readiness service today. The
 * interface is already the AI one — see `services/ai/README.md`.
 */

/* -------------------------------------------------------------------------- */
/* Assembly                                                                   */
/* -------------------------------------------------------------------------- */

export type PassportOptions = {
  /** The requesting user, when there is one. Controls privacy enforcement. */
  viewer?: {
    id: string;
    role: string;
    collegeId: string | null;
    employerVerified?: boolean;
  } | null;
  /** Records a PassportView row. Suppressed for the owner's own visits. */
  recordView?: boolean;
};

export async function buildPassport(
  username: string,
  options: PassportOptions = {},
): Promise<PassportDto> {
  const user = await prisma.user.findFirst({
    where: { username: username.toLowerCase(), deletedAt: null },
    select: {
      id: true,
      username: true,
      fullName: true,
      avatarUrl: true,
      bio: true,
      role: true,
      collegeId: true,
      college: { select: { id: true, name: true, logoUrl: true } },
      department: { select: { id: true, name: true, code: true } },
      consentToEmployerSearch: true,
      studentProfile: {
        select: {
          id: true,
          headline: true,
          location: true,
          linkedinUrl: true,
          githubUrl: true,
          portfolioUrl: true,
          careerInterests: true,
          passportVisibility: true,
          readinessScore: true,
          readinessUpdatedAt: true,
          rollNumber: true,
          degree: true,
          graduationYear: true,
          cgpa: true,
          eventsAttended: true,
          certificatesEarned: true,
          projectsCompleted: true,
          internshipsCompleted: true,
        },
      },
    },
  });

  if (!user || !user.studentProfile) throw new NotFoundError('Career passport');

  const profile = user.studentProfile;

  // --- Privacy --------------------------------------------------------------
  const isOwner = options.viewer?.id === user.id;
  const viewer = options.viewer;

  const canView = await resolveVisibility({
    profile: { passportVisibility: profile.passportVisibility as PassportVisibility },
    consentToEmployerSearch: user.consentToEmployerSearch,
    ownerId: user.id,
    profileCollegeId: user.collegeId,
    viewer: viewer ?? null,
  });

  if (!canView.allowed) {
    throw new ForbiddenError(canView.reason ?? 'This passport is private');
  }

  // --- Evidence -------------------------------------------------------------
  const [skills, attendances, memberships, certificates, projects, internships, interviews] =
    await Promise.all([
      prisma.studentSkill.findMany({
        where: { studentProfileId: profile.id, deletedAt: null },
        orderBy: [{ score: 'desc' }],
        select: {
          id: true,
          proficiency: true,
          score: true,
          source: true,
          isVerified: true,
          skill: {
            select: {
              name: true,
              category: { select: { name: true } },
            },
          },
        },
      }),

      // Campus experience comes from confirmed attendance, not registration.
      prisma.attendance.findMany({
        where: { studentId: user.id, revokedAt: null },
        orderBy: { markedAt: 'desc' },
        take: 60,
        select: {
          id: true,
          markedAt: true,
          event: {
            select: {
              id: true,
              title: true,
              category: true,
              startAt: true,
              endAt: true,
              club: { select: { name: true } },
            },
          },
          registration: {
            select: {
              certificate: { select: { certificateId: true, status: true } },
            },
          },
        },
      }),

      prisma.clubMembership.findMany({
        where: { userId: user.id, status: 'ACTIVE', deletedAt: null },
        select: {
          id: true,
          role: true,
          joinedAt: true,
          club: { select: { name: true, category: true } },
        },
      }),

      prisma.certificate.findMany({
        where: { studentId: user.id, deletedAt: null, status: { in: ['ISSUED', 'REVOKED'] } },
        orderBy: { issuedAt: 'desc' },
        select: {
          certificateId: true,
          title: true,
          type: true,
          status: true,
          issuedAt: true,
          position: true,
          college: { select: { name: true } },
          event: { select: { title: true } },
        },
      }),

      prisma.projectSubmission.findMany({
        where: { userId: user.id, isApproved: true, deletedAt: null },
        orderBy: { approvedAt: 'desc' },
        select: {
          id: true,
          summary: true,
          repoUrl: true,
          liveUrl: true,
          thumbnailUrl: true,
          approvedAt: true,
          score: true,
          project: {
            select: { title: true, techStack: true, difficulty: true, skillIds: true },
          },
          reviews: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { totalScore: true, maxScore: true, feedback: true },
          },
        },
      }),

      prisma.application.findMany({
        where: {
          userId: user.id,
          internshipId: { not: null },
          status: { in: ['HIRED', 'OFFER', 'INTERVIEWED'] },
          deletedAt: null,
        },
        orderBy: { appliedAt: 'desc' },
        select: {
          id: true,
          status: true,
          internship: {
            select: {
              title: true,
              role: true,
              workMode: true,
              stipendMonthly: true,
              durationMonths: true,
              startDate: true,
              companyName: true,
            },
          },
        },
      }),

      prisma.mockInterview.findMany({
        where: { candidateId: user.id, status: 'COMPLETED' },
        orderBy: { scheduledAt: 'desc' },
        select: {
          id: true,
          targetRole: true,
          scheduledAt: true,
          feedback: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: {
              overallScore: true,
              communicationScore: true,
              confidenceScore: true,
              contentScore: true,
            },
          },
        },
      }),
    ]);

  // --- Readiness ------------------------------------------------------------
  const readinessInput: ReadinessInput = {
    skills: skills.map((skill) => ({
      score: skill.score,
      verified: skill.isVerified,
      proficiency: skill.proficiency as ProficiencyLevel,
      categoryName: skill.skill.category.name,
      name: skill.skill.name,
    })),
    projects: projects.map((submission) => ({
      approved: true,
      score: submission.reviews[0]?.totalScore ?? submission.score ?? null,
      techStack: submission.project.techStack,
      difficulty: submission.project.difficulty,
    })),
    internships: internships.map((application) => ({
      completed: application.status === 'HIRED',
      isPremium: false,
      durationMonths: application.internship?.durationMonths ?? null,
      role: application.internship?.role ?? application.internship?.title ?? '',
    })),
    interviews: interviews.map((interview) => ({
      completed: true,
      overallScore: interview.feedback[0]?.overallScore ?? null,
      communicationScore: interview.feedback[0]?.communicationScore ?? null,
      confidenceScore: interview.feedback[0]?.confidenceScore ?? null,
      contentScore: interview.feedback[0]?.contentScore ?? null,
    })),
    certificateCount: certificates.filter((c) => c.status === 'ISSUED').length,
    eventsAttended: attendances.length,
    careerInterests: profile.careerInterests,
  };

  const readiness = calculateReadiness(readinessInput);

  // --- Experience timeline --------------------------------------------------
  const experience: PassportDto['experience'] = [
    ...attendances.map((attendance) => ({
      id: `attendance-${attendance.id}`,
      kind: 'EVENT' as const,
      title: attendance.event.title,
      organization: attendance.event.club?.name ?? null,
      role: null,
      description: null,
      startAt: attendance.event.startAt,
      endAt: attendance.event.endAt,
      certificateId:
        attendance.registration.certificate?.status === 'ISSUED'
          ? attendance.registration.certificate.certificateId
          : null,
    })),
    ...memberships.map((membership) => ({
      id: `club-${membership.id}`,
      kind: 'CLUB' as const,
      title: membership.club.name,
      organization: membership.club.name,
      // "PRESIDENT" reads better as "President" on a passport than screaming caps.
      role: titleCase(membership.role),
      description: null,
      startAt: membership.joinedAt ?? new Date(),
      endAt: null,
      certificateId: null,
    })),
  ].sort((a, b) => b.startAt.getTime() - a.startAt.getTime());

  // --- Record the view ------------------------------------------------------
  if (options.recordView && !isOwner && viewer) {
    void recordPassportView(profile.id, viewer).catch((error: unknown) => {
      logger.warn('Failed to record passport view', { profileId: profile.id, error: String(error) });
    });
  }

  // --- Compose --------------------------------------------------------------
  const shareUrl = `${env.WEB_URL}/passport/${user.username}`;

  return {
    username: user.username!,
    fullName: user.fullName,
    avatarUrl: user.avatarUrl,
    headline: profile.headline,
    bio: user.bio,
    location: profile.location,
    visibility: profile.passportVisibility as PassportVisibility,
    links: {
      linkedin: profile.linkedinUrl,
      github: profile.githubUrl,
      portfolio: profile.portfolioUrl,
    },
    education: {
      collegeName: user.college?.name ?? '',
      collegeLogoUrl: user.college?.logoUrl ?? null,
      departmentName: user.department?.name ?? null,
      degree: profile.degree,
      graduationYear: profile.graduationYear,
      cgpa: profile.cgpa ? Number(profile.cgpa) : null,
      // A roll number is institution-internal and is withheld from employers.
      rollNumber: isOwner || canView.isInstitutional ? profile.rollNumber : null,
    },
    careerInterests: profile.careerInterests,
    skills: skills.map((skill) => ({
      id: skill.id,
      name: skill.skill.name,
      category: skill.skill.category.name,
      proficiency: skill.proficiency as ProficiencyLevel,
      score: skill.score,
      source: skill.source as PassportDto['skills'][number]['source'],
      verified: skill.isVerified,
    })),
    experience,
    projects: projects.map((submission) => ({
      id: submission.id,
      title: submission.project.title,
      summary: submission.summary,
      techStack: submission.project.techStack,
      repoUrl: submission.repoUrl,
      liveUrl: submission.liveUrl,
      thumbnailUrl: submission.thumbnailUrl,
      approvedAt: submission.approvedAt,
      rubricScore: submission.reviews[0]?.totalScore ?? submission.score ?? null,
    })),
    internships: internships
      .filter((application) => application.internship !== null)
      .map((application) => ({
        id: application.id,
        role: application.internship!.role ?? application.internship!.title,
        organization: application.internship!.companyName,
        workMode: application.internship!.workMode,
        startAt: application.internship!.startDate ?? new Date(),
        endAt: null,
        stipend: application.internship!.stipendMonthly,
        completed: application.status === 'HIRED',
      })),
    certificates: certificates.map((certificate) => ({
      certificateId: certificate.certificateId,
      title: certificate.title,
      type: certificate.type,
      issuedAt: certificate.issuedAt,
      issuer: certificate.college.name,
      // Only an ISSUED certificate carries a verification badge. A revoked one is
      // still listed, so the record is honest about its own history.
      verified: certificate.status === 'ISSUED',
      verifyUrl: `${env.WEB_URL}/verify/${certificate.certificateId}`,
    })),
    readiness: {
      score: readiness.score,
      band: readiness.band,
      breakdown: readiness.breakdown,
      suggestions: readiness.suggestions.map((suggestion) => suggestion.title),
      calculatedAt: readiness.calculatedAt,
    },
    stats: {
      eventsAttended: attendances.length,
      certificatesEarned: certificates.filter((c) => c.status === 'ISSUED').length,
      projectsCompleted: projects.length,
      internshipsCompleted: internships.filter((a) => a.status === 'HIRED').length,
    },
    shareUrl,
    generatedAt: new Date(),
  };
}

/* -------------------------------------------------------------------------- */
/* Privacy                                                                    */
/* -------------------------------------------------------------------------- */

type VisibilityInput = {
  profile: { passportVisibility: PassportVisibility };
  consentToEmployerSearch: boolean;
  ownerId: string;
  profileCollegeId: string | null;
  viewer: { id: string; role: string; collegeId: string | null; employerVerified?: boolean } | null;
};

/**
 * Resolves whether a viewer may see a passport, and what extra fields they get.
 *
 * The rules, in priority order:
 *
 *  1. The owner always sees their own passport in full.
 *  2. A **verified** employer sees an EMPLOYERS_ONLY or PUBLIC passport *only* when
 *     the student has explicitly consented to employer search. Verification alone is
 *     not consent — a company clearing KYC does not entitle it to browse students
 *     who never opted in. This is the platform's core privacy promise.
 *  3. College staff see passports within their own college, so an officer can
 *     review a student's record for a placement drive.
 *  4. A platform admin sees everything.
 *  5. PUBLIC passports are readable by anyone with the link.
 */
async function resolveVisibility(
  input: VisibilityInput,
): Promise<{ allowed: boolean; isInstitutional: boolean; reason?: string }> {
  const { viewer, ownerId, profile, consentToEmployerSearch, profileCollegeId } = input;

  if (viewer?.id === ownerId) return { allowed: true, isInstitutional: true };

  // No viewer: only a PUBLIC passport is readable.
  if (!viewer) {
    return profile.passportVisibility === 'PUBLIC'
      ? { allowed: true, isInstitutional: false }
      : { allowed: false, isInstitutional: false, reason: 'This passport is private. Ask the student for a share link.' };
  }

  if (viewer.role === 'SUPER_ADMIN') return { allowed: true, isInstitutional: true };

  if (viewer.role === 'EMPLOYER') {
    if (profile.passportVisibility === 'PRIVATE') {
      return {
        allowed: false,
        isInstitutional: false,
        reason: 'This student has set their passport to private.',
      };
    }

    /*
     * Consent is checked live, not cached on the snapshot an employer might have
     * seen earlier — a student who withdraws consent loses access immediately.
     */
    if (!consentToEmployerSearch) {
      return {
        allowed: false,
        isInstitutional: false,
        reason: 'This student has not opted in to employer search.',
      };
    }

    if (!viewer.employerVerified) {
      return {
        allowed: false,
        isInstitutional: false,
        reason: 'Your company profile is still being verified. You can search candidates once it is approved.',
      };
    }

    return { allowed: true, isInstitutional: false };
  }

  // College staff: same college only.
  if (roleHasPermission(viewer.role as never, 'analytics:read_college')) {
    if (viewer.collegeId && viewer.collegeId === profileCollegeId) {
      return { allowed: true, isInstitutional: true };
    }
    return {
      allowed: false,
      isInstitutional: false,
      reason: 'That student belongs to another institution.',
    };
  }

  // A fellow student, or anyone else: only a PUBLIC passport.
  if (profile.passportVisibility === 'PUBLIC') return { allowed: true, isInstitutional: false };

  return {
    allowed: false,
    isInstitutional: false,
    reason: 'This passport is visible to employers only.',
  };
}

async function recordPassportView(
  studentProfileId: string,
  viewer: { id: string; role: string },
): Promise<void> {
  const employerProfile =
    viewer.role === 'EMPLOYER'
      ? await prisma.employerProfile.findUnique({
          where: { userId: viewer.id },
          select: { id: true, companyName: true },
        })
      : null;

  await prisma.passportView.create({
    data: {
      studentProfileId,
      viewerUserId: viewer.id,
      viewerEmployerId: employerProfile?.id ?? null,
      viewerLabel: employerProfile?.companyName ?? null,
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Recalculation                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Recomputes and persists a student's readiness score.
 *
 * Called after any write that changes the evidence: attendance marked, project
 * approved, mock interview scored, certificate issued. Writes both the score and a
 * daily `ReadinessSnapshot`, which is what the student's trend chart reads.
 *
 * Deliberately swallows failures — a readiness recalculation must never roll back
 * the attendance it was triggered by.
 */
export async function recalculateReadiness(studentId: string): Promise<number | null> {
  try {
    const profile = await prisma.studentProfile.findUnique({
      where: { userId: studentId },
      select: { id: true, careerInterests: true },
    });

    if (!profile) return null;

    const [skills, submissions, internshipApplications, interviews, certificateCount, eventsAttended] =
      await Promise.all([
        prisma.studentSkill.findMany({
          where: { studentProfileId: profile.id, deletedAt: null },
          select: {
            score: true,
            isVerified: true,
            proficiency: true,
            skill: { select: { name: true, category: { select: { name: true } } } },
          },
        }),
        prisma.projectSubmission.findMany({
          where: { userId: studentId, isApproved: true, deletedAt: null },
          select: {
            score: true,
            reviews: { orderBy: { createdAt: 'desc' }, take: 1, select: { totalScore: true } },
            project: { select: { techStack: true, difficulty: true } },
          },
        }),
        prisma.application.findMany({
          where: { userId: studentId, internshipId: { not: null }, deletedAt: null },
          select: {
            status: true,
            internship: { select: { durationMonths: true, role: true, title: true } },
          },
        }),
        prisma.mockInterview.findMany({
          where: { candidateId: studentId, status: 'COMPLETED' },
          select: {
            feedback: {
              orderBy: { createdAt: 'desc' },
              take: 1,
              select: {
                overallScore: true,
                communicationScore: true,
                confidenceScore: true,
                contentScore: true,
              },
            },
          },
        }),
        prisma.certificate.count({
          where: { studentId, status: 'ISSUED', deletedAt: null },
        }),
        prisma.attendance.count({ where: { studentId, revokedAt: null } }),
      ]);

    const readiness = calculateReadiness({
      skills: skills.map((skill) => ({
        score: skill.score,
        verified: skill.isVerified,
        proficiency: skill.proficiency as ProficiencyLevel,
        categoryName: skill.skill.category.name,
        name: skill.skill.name,
      })),
      projects: submissions.map((submission) => ({
        approved: true,
        score: submission.reviews[0]?.totalScore ?? submission.score ?? null,
        techStack: submission.project.techStack,
        difficulty: submission.project.difficulty,
      })),
      internships: internshipApplications.map((application) => ({
        completed: application.status === 'HIRED',
        isPremium: false,
        durationMonths: application.internship?.durationMonths ?? null,
        role: application.internship?.role ?? application.internship?.title ?? '',
      })),
      interviews: interviews.map((interview) => ({
        completed: true,
        overallScore: interview.feedback[0]?.overallScore ?? null,
        communicationScore: interview.feedback[0]?.communicationScore ?? null,
        confidenceScore: interview.feedback[0]?.confidenceScore ?? null,
        contentScore: interview.feedback[0]?.contentScore ?? null,
      })),
      certificateCount,
      eventsAttended,
      careerInterests: profile.careerInterests,
    });

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    await prisma.$transaction([
      prisma.studentProfile.update({
        where: { id: profile.id },
        data: {
          readinessScore: readiness.score,
          readinessSkills: readiness.breakdown.skills,
          readinessProjects: readiness.breakdown.projects,
          readinessInternship: readiness.breakdown.internship,
          readinessInterview: readiness.breakdown.interview,
          readinessUpdatedAt: new Date(),
          eventsAttended,
          certificatesEarned: certificateCount,
          projectsCompleted: submissions.length,
          internshipsCompleted: internshipApplications.filter((a) => a.status === 'HIRED').length,
        },
      }),
      // One snapshot per day: a re-run on the same day overwrites rather than
      // creating duplicates, which keeps the trend chart honest.
      prisma.readinessSnapshot.upsert({
        where: { studentProfileId_capturedOn: { studentProfileId: profile.id, capturedOn: today } },
        create: {
          studentProfileId: profile.id,
          capturedOn: today,
          score: readiness.score,
          skills: readiness.breakdown.skills,
          projects: readiness.breakdown.projects,
          internship: readiness.breakdown.internship,
          interview: readiness.breakdown.interview,
        },
        update: {
          score: readiness.score,
          skills: readiness.breakdown.skills,
          projects: readiness.breakdown.projects,
          internship: readiness.breakdown.internship,
          interview: readiness.breakdown.interview,
        },
      }),
    ]);

    return readiness.score;
  } catch (error) {
    logger.error('Readiness recalculation failed', error, { studentId });
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Trend                                                                      */
/* -------------------------------------------------------------------------- */

/** Readiness history for the student's progress chart. */
export async function readinessTrend(studentId: string, days = 90) {
  const profile = await prisma.studentProfile.findUnique({
    where: { userId: studentId },
    select: { id: true, readinessScore: true },
  });

  if (!profile) throw new NotFoundError('Student profile');

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const snapshots = await prisma.readinessSnapshot.findMany({
    where: { studentProfileId: profile.id, capturedOn: { gte: since } },
    orderBy: { capturedOn: 'asc' },
    select: {
      capturedOn: true,
      score: true,
      skills: true,
      projects: true,
      internship: true,
      interview: true,
    },
  });

  const first = snapshots[0]?.score ?? profile.readinessScore;
  const latest = snapshots[snapshots.length - 1]?.score ?? profile.readinessScore;

  return {
    current: profile.readinessScore,
    change: latest - first,
    direction: latest > first ? 'up' : latest < first ? 'down' : 'flat',
    band: readinessBand(profile.readinessScore).label,
    points: snapshots.map((snapshot) => ({
      date: snapshot.capturedOn,
      score: snapshot.score,
      skills: snapshot.skills,
      projects: snapshot.projects,
      internship: snapshot.internship,
      interview: snapshot.interview,
    })),
  };
}

/* -------------------------------------------------------------------------- */
/* Privacy updates                                                            */
/* -------------------------------------------------------------------------- */

export async function updatePrivacy(
  userId: string,
  input: { visibility?: PassportVisibility; consentToEmployerSearch?: boolean },
  context: AuditContext,
): Promise<{ visibility: PassportVisibility; consentToEmployerSearch: boolean }> {
  const before = assertFound(
    await prisma.studentProfile.findUnique({
      where: { userId },
      select: { passportVisibility: true },
    }),
    'Student profile',
  );

  const userBefore = await prisma.user.findUnique({
    where: { id: userId },
    select: { consentToEmployerSearch: true },
  });

  const [profile, user] = await prisma.$transaction([
    prisma.studentProfile.update({
      where: { userId },
      data: {
        ...(input.visibility !== undefined ? { passportVisibility: input.visibility } : {}),
      },
      select: { passportVisibility: true },
    }),
    prisma.user.update({
      where: { id: userId },
      data: {
        ...(input.consentToEmployerSearch !== undefined
          ? { consentToEmployerSearch: input.consentToEmployerSearch }
          : {}),
      },
      select: { consentToEmployerSearch: true },
    }),
  ]);

  /*
   * Changing visibility is a privacy-relevant action, so it is audited with both
   * values — an institution investigating a complaint needs to know when consent
   * was withdrawn, not merely that it is currently absent.
   */
  auditAction(context, 'UPDATE', 'StudentProfile', userId, {
    visibility: { from: before.passportVisibility, to: profile.passportVisibility },
    consentToEmployerSearch: {
      from: userBefore?.consentToEmployerSearch ?? false,
      to: user.consentToEmployerSearch,
    },
  });

  return {
    visibility: profile.passportVisibility as PassportVisibility,
    consentToEmployerSearch: user.consentToEmployerSearch,
  };
}

/* -------------------------------------------------------------------------- */
/* Sharing                                                                    */
/* -------------------------------------------------------------------------- */

/** QR code and share metadata for the passport. */
export async function shareData(username: string, viewerId: string | null) {
  const user = assertFound(
    await prisma.user.findFirst({
      where: { username: username.toLowerCase(), deletedAt: null },
      select: { id: true, username: true, fullName: true },
    }),
    'Profile',
  );

  const shareUrl = `${env.WEB_URL}/passport/${user.username}`;
  const qrDataUrl = await generateQrDataUrl(shareUrl, { width: 320 });

  const viewCount = await prisma.passportView.count({
    where: { studentProfile: { userId: user.id } },
  });

  return {
    shareUrl,
    qrDataUrl,
    /** LinkedIn/WhatsApp share targets pre-filled with the URL. */
    shareTargets: {
      linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}`,
      whatsapp: `https://wa.me/?text=${encodeURIComponent(`My CampusConnect Career Passport: ${shareUrl}`)}`,
    },
    // Only the owner learns how many times their passport was viewed.
    viewCount: viewerId === user.id ? viewCount : null,
  };
}

/**
 * Exports the passport as a PDF.
 *
 * Reuses the resume renderer rather than a bespoke layout: an employer asking for
 * "the passport" almost always wants something they can print and file, and a
 * resume-shaped document is what their process expects.
 */
export async function exportPdf(username: string, options: PassportOptions = {}): Promise<Buffer> {
  const passport = await buildPassport(username, { ...options, recordView: false });

  const input: ResumePdfInput = {
    fullName: passport.fullName,
    headline: passport.headline,
    email: '',
    phone: null,
    location: passport.location,
    linkedinUrl: passport.links.linkedin,
    githubUrl: passport.links.github,
    portfolioUrl: passport.links.portfolio,
    summary: passport.bio,
    education: [
      {
        institution: passport.education.collegeName,
        degree: [passport.education.degree, passport.education.departmentName].filter(Boolean).join(', '),
        year: passport.education.graduationYear ? `Class of ${passport.education.graduationYear}` : null,
        detail: passport.education.cgpa ? `CGPA ${passport.education.cgpa}` : null,
      },
    ],
    skills: passport.skills.map((skill) => ({
      name: skill.name,
      level: skill.verified ? `${titleCase(skill.proficiency)} · verified` : titleCase(skill.proficiency),
    })),
    experience: passport.internships.map((internship) => ({
      role: internship.role,
      organization: internship.organization,
      period: `${formatMonth(internship.startAt)} – ${internship.completed ? 'Completed' : 'Present'}`,
      bullets: [`${titleCase(internship.workMode)} engagement${internship.stipend ? `, ₹${internship.stipend / 100}/month` : ''}`],
    })),
    projects: passport.projects.map((project) => ({
      title: project.title,
      tech: project.techStack.join(' · '),
      bullets: [
        ...(project.summary ? [project.summary] : []),
        ...(project.rubricScore !== null ? [`Mentor rubric score: ${project.rubricScore}/100`] : []),
      ],
    })),
    certifications: passport.certificates
      .filter((certificate) => certificate.verified)
      .map((certificate) => ({
        title: certificate.title,
        issuer: certificate.issuer,
        date: formatMonth(certificate.issuedAt),
        certificateId: certificate.certificateId,
      })),
    achievements: [
      `Career Readiness: ${passport.readiness.score}/100 (${passport.readiness.band})`,
      ...passport.experience
        .filter((entry) => entry.role)
        .slice(0, 5)
        .map((entry) => `${entry.role} — ${entry.organization}`),
    ],
  };

  return generateResumePdf(input);
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split(/[_\s]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function formatMonth(date: Date): string {
  return new Intl.DateTimeFormat('en-IN', {
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  }).format(date);
}

export { resolveVisibility, titleCase, proficiencyForScore };
