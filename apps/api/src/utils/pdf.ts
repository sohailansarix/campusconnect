/**
 * PDF generation for certificates.
 *
 * PDFKit is used imperatively (no HTML template engine) so the output is
 * deterministic and has no headless-browser dependency in the deploy. Layout is
 * A4 landscape, which is the format an Indian college prints certificates in.
 *
 * Fonts: the built-in Helvetica covers Latin-1. Names in Devanagari or other
 * non-Latin scripts would render as blanks, so `resolveFont` checks the string
 * and falls back to a bundled Unicode TTF when one is present, logging a warning
 * when it is not. TODO(Phase 2): bundle Noto Sans + Noto Sans Devanagari and set
 * them as the default pair.
 */

import PDFDocument from 'pdfkit';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

export type CertificatePdfInput = {
  certificateId: string;
  title: string;
  recipientName: string;
  /** Free text under the title, e.g. "for participating in the 24-hour hackathon". */
  bodyText: string;
  collegeName: string;
  collegeLogoPath?: string | null;
  /** Rendered signatory block. */
  signatoryName?: string | null;
  signatoryTitle?: string | null;
  signatureLabel?: string | null;
  mentorNames?: string[];
  issuedOn: Date;
  primaryColor?: string;
  /** QR encoding the public verification URL, as a PNG buffer. */
  verificationQr?: Buffer | null;
  verificationUrl?: string | null;
  organizerName?: string | null;
  position?: string | null;
};

export type ResumePdfInput = {
  templateId?: 'classic' | 'modern' | 'minimal' | 'academic';
  fullName: string;
  headline?: string | null;
  email: string;
  phone?: string | null;
  location?: string | null;
  linkedinUrl?: string | null;
  githubUrl?: string | null;
  portfolioUrl?: string | null;
  summary?: string | null;
  education: { institution: string; degree?: string | null; year?: string | null; detail?: string | null }[];
  skills: { name: string; level?: string | null }[];
  experience: { role: string; organization: string; period: string; bullets: string[] }[];
  projects: { title: string; tech?: string | null; bullets: string[] }[];
  certifications: { title: string; issuer: string; date: string; certificateId?: string | null }[];
  achievements?: string[];
};

const A4_LANDSCAPE = { size: 'A4' as const, layout: 'landscape' as const, margin: 40 };
const A4_PORTRAIT = { size: 'A4' as const, layout: 'portrait' as const, margin: 50 };

/** True when every character is representable in the standard PDF fonts. */
function isLatinOnly(text: string): boolean {
  return /^[\u0000-ɏ -⁯₠-₿]*$/.test(text);
}

const UNICODE_FONT_CANDIDATES = [
  path.join(env.apiRoot, 'assets', 'fonts', 'NotoSans-Regular.ttf'),
  '/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf',
];

function resolveUnicodeFont(): string | null {
  return UNICODE_FONT_CANDIDATES.find((candidate) => existsSync(candidate)) ?? null;
}

/**
 * Registers a font family and returns the name to use. Falls back to Helvetica
 * with a warning rather than throwing — a certificate with a mangled name is
 * better than no certificate, and the warning surfaces the fix.
 */
function registerFonts(doc: PDFKit.PDFDocument, sampleText: string): { regular: string; bold: string } {
  const needsUnicode = !isLatinOnly(sampleText);
  if (!needsUnicode) return { regular: 'Helvetica', bold: 'Helvetica-Bold' };

  const regularPath = resolveUnicodeFont();
  if (!regularPath) {
    logger.warn(
      'Non-Latin text in a certificate but no Unicode font is bundled; glyphs will be missing. ' +
        'Add assets/fonts/NotoSans-Regular.ttf to fix.',
      { sample: sampleText.slice(0, 40) },
    );
    return { regular: 'Helvetica', bold: 'Helvetica-Bold' };
  }

  doc.registerFont('Unicode', regularPath);
  return { regular: 'Unicode', bold: 'Unicode' };
}

function collectPdf(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
}

function formatIssuedOn(date: Date): string {
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  }).format(date);
}

/* -------------------------------------------------------------------------- */
/* Certificate                                                                */
/* -------------------------------------------------------------------------- */

export async function generateCertificatePdf(input: CertificatePdfInput): Promise<Buffer> {
  const doc = new PDFDocument({
    ...A4_LANDSCAPE,
    info: {
      Title: input.title,
      Author: input.collegeName,
      Subject: `Certificate ${input.certificateId}`,
      Keywords: 'campusconnect,certificate',
      CreationDate: new Date(),
    },
  });

  const fonts = registerFonts(doc, `${input.recipientName} ${input.bodyText}`);
  const accent = input.primaryColor ?? '#2563EB';
  const pageWidth = doc.page.width;
  const pageHeight = doc.page.height;
  const contentWidth = pageWidth - 160;
  const left = 80;

  // --- Border ---------------------------------------------------------------
  doc.rect(24, 24, pageWidth - 48, pageHeight - 48).lineWidth(2).strokeColor(accent).stroke();
  doc.rect(32, 32, pageWidth - 64, pageHeight - 64).lineWidth(0.5).strokeColor('#CBD5E1').stroke();

  let cursorY = 66;

  // --- Issuer ---------------------------------------------------------------
  if (input.collegeLogoPath && existsSync(input.collegeLogoPath)) {
    try {
      doc.image(input.collegeLogoPath, pageWidth / 2 - 32, cursorY, { fit: [64, 64] });
      cursorY += 76;
    } catch (error) {
      logger.warn('Certificate logo could not be embedded', { error: String(error) });
    }
  }

  doc
    .font(fonts.bold)
    .fontSize(15)
    .fillColor('#0F172A')
    .text(input.collegeName.toUpperCase(), left, cursorY, { width: contentWidth, align: 'center' });

  cursorY = doc.y + 10;

  doc
    .font(fonts.regular)
    .fontSize(11)
    .fillColor('#64748B')
    .text('CERTIFICATE OF ' + (input.position ? 'ACHIEVEMENT' : 'PARTICIPATION'), left, cursorY, {
      width: contentWidth,
      align: 'center',
      characterSpacing: 2,
    });

  cursorY = doc.y + 26;

  doc
    .font(fonts.bold)
    .fontSize(13)
    .fillColor('#64748B')
    .text('This is to certify that', left, cursorY, { width: contentWidth, align: 'center' });

  // --- Recipient ------------------------------------------------------------
  cursorY = doc.y + 12;
  doc
    .font(fonts.bold)
    .fontSize(34)
    .fillColor(accent)
    .text(input.recipientName, left, cursorY, { width: contentWidth, align: 'center' });

  // Rule under the name, sized to the text rather than the page.
  const nameWidth = Math.min(doc.widthOfString(input.recipientName), contentWidth);
  cursorY = doc.y + 6;
  doc
    .moveTo(pageWidth / 2 - nameWidth / 2 - 20, cursorY)
    .lineTo(pageWidth / 2 + nameWidth / 2 + 20, cursorY)
    .lineWidth(1)
    .strokeColor(accent)
    .stroke();

  // --- Body -----------------------------------------------------------------
  cursorY += 20;
  doc
    .font(fonts.regular)
    .fontSize(13)
    .fillColor('#334155')
    .text(input.bodyText, left + 60, cursorY, { width: contentWidth - 120, align: 'center', lineGap: 5 });

  cursorY = doc.y + 14;

  if (input.mentorNames && input.mentorNames.length > 0) {
    doc
      .font(fonts.regular)
      .fontSize(10)
      .fillColor('#64748B')
      .text(`Mentored by ${input.mentorNames.join(', ')}`, left, cursorY, {
        width: contentWidth,
        align: 'center',
      });
    cursorY = doc.y + 8;
  }

  // --- Footer: signatures, date, verification -------------------------------
  const footerY = pageHeight - 132;

  // Signatory (left)
  doc
    .moveTo(left + 20, footerY)
    .lineTo(left + 200, footerY)
    .lineWidth(0.75)
    .strokeColor('#94A3B8')
    .stroke();
  doc
    .font(fonts.bold)
    .fontSize(11)
    .fillColor('#0F172A')
    .text(input.signatoryName ?? input.organizerName ?? 'Programme Coordinator', left, footerY + 6, {
      width: 200,
    });
  doc
    .font(fonts.regular)
    .fontSize(9)
    .fillColor('#64748B')
    .text(input.signatoryTitle ?? input.signatureLabel ?? 'Issuing Authority', left, doc.y + 2, { width: 200 });

  // Date (centre)
  doc
    .font(fonts.regular)
    .fontSize(10)
    .fillColor('#64748B')
    .text(`Issued on ${formatIssuedOn(input.issuedOn)}`, pageWidth / 2 - 100, footerY + 18, {
      width: 200,
      align: 'center',
    });

  // Verification block (right)
  const verifyRight = pageWidth - left - 200;
  if (input.verificationQr) {
    doc.image(input.verificationQr, verifyRight + 60, footerY - 42, { fit: [72, 72] });
  }
  doc
    .font(fonts.bold)
    .fontSize(9)
    .fillColor('#0F172A')
    .text(input.certificateId, verifyRight, footerY + 36, { width: 200, align: 'center' });
  doc
    .font(fonts.regular)
    .fontSize(7.5)
    .fillColor('#64748B')
    .text(
      input.verificationUrl ? `Verify at ${input.verificationUrl}` : 'Verify this certificate online',
      verifyRight,
      footerY + 50,
      { width: 200, align: 'center' },
    );

  doc.end();
  return collectPdf(doc);
}

/* -------------------------------------------------------------------------- */
/* Resume                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * A single-column, ATS-friendly resume. No tables, no multi-column text, no
 * text in images — those are the three things that make a resume unparseable by
 * the applicant tracking systems most Indian employers use.
 */
export async function generateResumePdf(input: ResumePdfInput): Promise<Buffer> {
  const template = input.templateId ?? 'classic';
  const accentByTemplate = { classic: '#2563EB', modern: '#0D9488', minimal: '#475569', academic: '#7C3AED' };
  const accent = accentByTemplate[template];
  const doc = new PDFDocument({
    ...A4_PORTRAIT,
    info: { Title: `${input.fullName} — Resume`, Author: input.fullName, CreationDate: new Date() },
  });

  const sample = [input.fullName, input.headline, ...input.education.map((e) => e.institution)]
    .filter(Boolean)
    .join(' ');
  const fonts = registerFonts(doc, sample);

  const left = A4_PORTRAIT.margin;
  const width = doc.page.width - left * 2;
  if (template === 'modern') doc.rect(0, 0, doc.page.width, 8).fill(accent);
  if (template === 'academic') {
    doc.moveTo(left, left - 12).lineTo(left + width, left - 12).lineWidth(1.5).strokeColor(accent).stroke();
  }

  const sectionHeading = (label: string) => {
    doc.moveDown(template === 'minimal' ? 0.65 : 0.9);
    const headingColor = template === 'minimal' ? '#334155' : accent;
    doc.font(fonts.bold).fontSize(template === 'minimal' ? 9.5 : 10.5).fillColor(headingColor).text(label.toUpperCase(), left, doc.y, {
      width,
      characterSpacing: template === 'academic' ? 1.5 : template === 'minimal' ? 0 : 1,
    });
    if (template !== 'minimal') {
      const y = doc.y + 3;
      doc.moveTo(left, y).lineTo(left + width, y).lineWidth(template === 'academic' ? 1 : 0.75).strokeColor(accent).stroke();
      doc.moveDown(0.4);
    } else {
      doc.moveDown(0.25);
    }
  };

  const bullets = (items: string[]) => {
    for (const item of items) {
      const bulletY = doc.y;
      doc.font(fonts.regular).fontSize(9.5).fillColor('#334155').text('•', left + 2, bulletY, { width: 12 });
      doc.text(item, left + 16, bulletY, { width: width - 16, lineGap: 2 });
    }
  };

  // --- Header ---------------------------------------------------------------
  const headerAlign = template === 'academic' ? 'center' : 'left';
  const nameColor = template === 'modern' ? '#0F766E' : '#0F172A';
  doc.font(fonts.bold).fontSize(template === 'academic' ? 22 : 20).fillColor(nameColor).text(input.fullName, left, left, { width, align: headerAlign });
  if (input.headline) {
    doc.moveDown(0.15);
    doc.font(fonts.regular).fontSize(10.5).fillColor('#475569').text(input.headline, { width, align: headerAlign });
  }

  const contactParts = [
    input.email,
    input.phone,
    input.location,
    input.linkedinUrl,
    input.githubUrl,
    input.portfolioUrl,
  ].filter((v): v is string => Boolean(v));

  doc.moveDown(0.25);
  doc.font(fonts.regular).fontSize(9).fillColor('#64748B').text(contactParts.join('  ·  '), { width, align: headerAlign });

  // --- Sections -------------------------------------------------------------
  if (input.summary) {
    sectionHeading('Summary');
    doc.font(fonts.regular).fontSize(9.5).fillColor('#334155').text(input.summary, { width, lineGap: 2 });
  }

  if (input.education.length > 0) {
    sectionHeading('Education');
    for (const entry of input.education) {
      doc.font(fonts.bold).fontSize(10.5).fillColor('#0F172A').text(entry.institution, { width });
      const meta = [entry.degree, entry.year, entry.detail].filter(Boolean).join(' · ');
      if (meta) doc.font(fonts.regular).fontSize(9.5).fillColor('#475569').text(meta, { width });
      doc.moveDown(0.35);
    }
  }

  if (input.experience.length > 0) {
    sectionHeading('Experience');
    for (const entry of input.experience) {
      doc
        .font(fonts.bold)
        .fontSize(10.5)
        .fillColor('#0F172A')
        .text(`${entry.role} — ${entry.organization}`, { width });
      doc.font(fonts.regular).fontSize(9).fillColor('#64748B').text(entry.period, { width });
      doc.moveDown(0.2);
      bullets(entry.bullets);
      doc.moveDown(0.35);
    }
  }

  if (input.projects.length > 0) {
    sectionHeading('Projects');
    for (const project of input.projects) {
      doc.font(fonts.bold).fontSize(10.5).fillColor('#0F172A').text(project.title, { width });
      if (project.tech) {
        doc.font(fonts.regular).fontSize(9).fillColor('#64748B').text(project.tech, { width });
      }
      doc.moveDown(0.2);
      bullets(project.bullets);
      doc.moveDown(0.35);
    }
  }

  if (input.skills.length > 0) {
    sectionHeading('Skills');
    const grouped = input.skills
      .map((s) => (s.level ? `${s.name} (${s.level})` : s.name))
      .join(', ');
    doc.font(fonts.regular).fontSize(9.5).fillColor('#334155').text(grouped, { width, lineGap: 2 });
  }

  if (input.certifications.length > 0) {
    sectionHeading('Certifications');
    for (const cert of input.certifications) {
      const suffix = cert.certificateId ? `  (${cert.certificateId})` : '';
      doc
        .font(fonts.regular)
        .fontSize(9.5)
        .fillColor('#334155')
        .text(`${cert.title} — ${cert.issuer}, ${cert.date}${suffix}`, { width });
    }
  }

  if (input.achievements && input.achievements.length > 0) {
    sectionHeading('Achievements');
    bullets(input.achievements);
  }

  doc.end();
  return collectPdf(doc);
}
