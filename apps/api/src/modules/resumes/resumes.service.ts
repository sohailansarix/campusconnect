import { prisma } from '../../config/prisma.js';
import { ai, type ResumeQualityInput } from '../../services/ai/index.js';
import { generateResumePdf } from '../../utils/pdf.js';
import { NotFoundError } from '../../utils/errors.js';
import { ensureUsername } from '../users/user.service.js';
import { buildPassport } from '../passport/passport.service.js';
import { resumeSchemas, type CreateResumeInput, type ResumeContent } from '@campusconnect/shared';

function qualityInput(content: ResumeContent): ResumeQualityInput {
  const bullets = [
    ...content.experience.flatMap((item) => item.bullets),
    ...content.projects.flatMap((item) => item.bullets),
  ];
  const weakOpeners = ['responsible for', 'worked on', 'helped with', 'involved in', 'assisted in', 'participated in'];
  return {
    hasSummary: Boolean(content.summary?.trim()),
    summaryWordCount: content.summary?.trim().split(/\s+/).filter(Boolean).length ?? 0,
    experienceCount: content.experience.length,
    projectCount: content.projects.length,
    skillCount: content.skills.length,
    certificateCount: content.certifications.length,
    hasLinkedin: Boolean(content.linkedinUrl),
    hasGithub: Boolean(content.githubUrl),
    hasPortfolio: Boolean(content.portfolioUrl),
    weakVerbCount: bullets.filter((bullet) => weakOpeners.some((opener) => bullet.trim().toLowerCase().startsWith(opener))).length,
    quantifiedBulletCount: bullets.filter((bullet) => /\d|%|₹/.test(bullet)).length,
    totalBulletCount: bullets.length,
    rawText: JSON.stringify(content),
  };
}

export async function listMine(userId: string) {
  const resumes = await prisma.resume.findMany({
    where: { userId, deletedAt: null },
    orderBy: [{ isPrimary: 'desc' }, { updatedAt: 'desc' }],
    select: { id: true, title: true, templateId: true, content: true, score: true, suggestions: true, scoredAt: true, isPrimary: true, version: true, updatedAt: true },
  });
  return resumes.map((resume) => ({ ...resume, content: resumeSchemas.resumeContentSchema.parse(resume.content) }));
}

export async function create(userId: string, input: CreateResumeInput) {
  const existingCount = await prisma.resume.count({ where: { userId, deletedAt: null } });
  const isPrimary = Boolean(input.isPrimary || existingCount === 0);
  return prisma.$transaction(async (tx) => {
    if (isPrimary) await tx.resume.updateMany({ where: { userId, deletedAt: null }, data: { isPrimary: false } });
    const resume = await tx.resume.create({
      data: {
        userId,
        title: input.title,
        templateId: input.templateId,
        content: input.content,
        isPrimary,
      },
      select: { id: true, title: true, templateId: true, content: true, score: true, suggestions: true, isPrimary: true, version: true, updatedAt: true },
    });
    return { ...resume, content: resumeSchemas.resumeContentSchema.parse(resume.content) };
  });
}

export async function createFromPassport(userId: string) {
  const [user, resumeCount] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, phone: true, role: true, collegeId: true } }),
    prisma.resume.count({ where: { userId, deletedAt: null } }),
  ]);
  if (!user) throw new NotFoundError('User');
  const username = await ensureUsername(userId);
  const passport = await buildPassport(username, { viewer: { id: user.id, role: user.role, collegeId: user.collegeId }, recordView: false });
  const content: ResumeContent = {
    headline: passport.headline ?? '',
    summary: passport.bio ?? '',
    phone: user.phone ?? '',
    location: passport.location ?? '',
    linkedinUrl: passport.links.linkedin ?? '',
    githubUrl: passport.links.github ?? '',
    portfolioUrl: passport.links.portfolio ?? '',
    education: [{
      institution: passport.education.collegeName,
      degree: [passport.education.degree, passport.education.departmentName].filter(Boolean).join(' · '),
      year: passport.education.graduationYear ? String(passport.education.graduationYear) : '',
      detail: passport.education.cgpa ? `CGPA ${passport.education.cgpa}` : '',
    }],
    skills: passport.skills.map((skill) => ({ name: skill.name, level: skill.proficiency })),
    experience: passport.internships.map((internship) => ({
      role: internship.role,
      organization: internship.organization,
      period: `${internship.startAt.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })} – ${internship.endAt?.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }) ?? 'Present'}`,
      bullets: [internship.completed ? 'Completed the internship successfully.' : 'Currently participating in the internship.'],
    })),
    projects: passport.projects.map((project) => ({
      title: project.title,
      tech: project.techStack.join(', '),
      bullets: [project.summary ?? 'Built and submitted this project for review.'],
    })),
    certifications: passport.certificates.map((certificate) => ({
      title: certificate.title,
      issuer: certificate.issuer,
      date: certificate.issuedAt.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }),
      certificateId: certificate.certificateId,
    })),
    achievements: passport.experience.slice(0, 8).map((item) => `${item.title}${item.organization ? ` — ${item.organization}` : ''}`),
  };
  return create(userId, {
    title: 'My Career Passport Resume',
    templateId: 'classic',
    content,
    isPrimary: resumeCount === 0,
  });
}

export async function update(userId: string, resumeId: string, input: Partial<CreateResumeInput>) {
  const existing = await prisma.resume.findFirst({ where: { id: resumeId, userId, deletedAt: null }, select: { id: true, isPrimary: true } });
  if (!existing) throw new NotFoundError('Resume');
  return prisma.$transaction(async (tx) => {
    if (input.isPrimary) await tx.resume.updateMany({ where: { userId, deletedAt: null }, data: { isPrimary: false } });
    const resume = await tx.resume.update({
      where: { id: resumeId },
      data: {
        ...(input.title ? { title: input.title } : {}),
        ...(input.templateId ? { templateId: input.templateId } : {}),
        ...(input.content ? { content: input.content, score: 0, suggestions: [], scoredAt: null, version: { increment: 1 } } : {}),
        ...(input.isPrimary !== undefined ? { isPrimary: input.isPrimary } : {}),
      },
      select: { id: true, title: true, templateId: true, content: true, score: true, suggestions: true, scoredAt: true, isPrimary: true, version: true, updatedAt: true },
    });
    return { ...resume, content: resumeSchemas.resumeContentSchema.parse(resume.content) };
  });
}

export async function review(userId: string, resumeId: string) {
  const resume = await prisma.resume.findFirst({ where: { id: resumeId, userId, deletedAt: null }, select: { id: true, content: true } });
  if (!resume) throw new NotFoundError('Resume');
  const content = resumeSchemas.resumeContentSchema.parse(resume.content);
  const result = await ai.resume(qualityInput(content));
  await prisma.resume.update({
    where: { id: resumeId },
    data: { score: result.score, suggestions: result.suggestions.map((item) => item.title), scoredAt: new Date() },
  });
  return result;
}

export async function exportPdf(userId: string, resumeId: string) {
  const [resume, user] = await Promise.all([
    prisma.resume.findFirst({ where: { id: resumeId, userId, deletedAt: null }, select: { id: true, content: true, title: true, templateId: true } }),
    prisma.user.findUnique({ where: { id: userId }, select: { fullName: true, email: true } }),
  ]);
  if (!resume || !user) throw new NotFoundError('Resume');
  const content = resumeSchemas.resumeContentSchema.parse(resume.content);
  return {
    title: resume.title,
    buffer: await generateResumePdf({ templateId: resume.templateId as 'classic' | 'modern' | 'minimal' | 'academic', fullName: user.fullName, email: user.email, ...content }),
  };
}
