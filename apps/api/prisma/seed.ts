/**
 * Database seed.
 *
 * Builds a realistic pilot dataset: **2 colleges, ~50 students, 20 events,
 * 10 courses, 15 jobs/internships across 5 employers** — plus the example persona
 * "Rahul Sharma, BBA, XYZ College" that the product brief calls for.
 *
 * Design notes:
 *
 *  * **Deterministic.** A seeded PRNG drives every random choice, so two runs
 *    produce the same database. Without this, a bug that reproduces on one
 *    developer's machine is unreproducible on another's.
 *
 *  * **Idempotent.** Running twice truncates the demo data first rather than
 *    failing on a unique constraint or duplicating rows.
 *
 *  * **Historically coherent.** Events are spread across the past 6 and next 8
 *    weeks; attendance exists only for past events; certificates exist only for
 *    attended past events; readiness scores are computed from the evidence rather
 *    than invented. A seed where a certificate exists for a future event makes
 *    every analytics chart nonsense.
 *
 * Run with `npm run db:seed`.
 */

import { PrismaClient, type Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const DEFAULT_PASSWORD = process.env.SEED_DEFAULT_PASSWORD ?? 'Password@123';

/* -------------------------------------------------------------------------- */
/* Deterministic randomness                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Mulberry32 — a small, fast, seeded PRNG.
 *
 * Adequate for generating plausible demo data and, crucially, reproducible. Not
 * for anything security-related.
 */
function createRng(seed: number) {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = createRng(20260215);

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)]!;
}

function pickMany<T>(items: readonly T[], count: number): T[] {
  const pool = [...items];
  const out: T[] = [];
  for (let i = 0; i < count && pool.length > 0; i += 1) {
    out.push(...pool.splice(Math.floor(rng() * pool.length), 1));
  }
  return out;
}

function intBetween(min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function chance(probability: number): boolean {
  return rng() < probability;
}

function daysFromNow(days: number, hour = 10): Date {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(hour, 0, 0, 0);
  return date;
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70);
}

/** Human-readable certificate id, matching `utils/ids.ts`. */
const CERT_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function certificateId(year: number): string {
  let body = '';
  for (let i = 0; i < 6; i += 1) body += CERT_ALPHABET[intBetween(0, CERT_ALPHABET.length - 1)];
  return `CC-${year}-${body}`;
}

function passCode(): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let raw = '';
  for (let i = 0; i < 8; i += 1) raw += alphabet[intBetween(0, alphabet.length - 1)];
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

/* -------------------------------------------------------------------------- */
/* Name and content pools                                                     */
/* -------------------------------------------------------------------------- */

const FIRST_NAMES = [
  'Aarav', 'Vivaan', 'Aditya', 'Vihaan', 'Arjun', 'Sai', 'Reyansh', 'Ayaan', 'Krishna', 'Ishaan',
  'Ananya', 'Diya', 'Aadhya', 'Saanvi', 'Pari', 'Anika', 'Navya', 'Myra', 'Sara', 'Ira',
  'Rohan', 'Kabir', 'Dhruv', 'Yash', 'Nikhil', 'Manish', 'Rakesh', 'Suresh', 'Pooja', 'Neha',
  'Priya', 'Sneha', 'Kavya', 'Meera', 'Riya', 'Tanvi', 'Divya', 'Shreya', 'Aisha', 'Fatima',
  'Karthik', 'Vikram', 'Siddharth', 'Aryan', 'Devansh', 'Harsh', 'Rudra', 'Advait', 'Zara', 'Naina',
];

const LAST_NAMES = [
  'Sharma', 'Verma', 'Gupta', 'Agarwal', 'Bansal', 'Jain', 'Singh', 'Yadav', 'Kumar', 'Mishra',
  'Tiwari', 'Pandey', 'Chauhan', 'Rathore', 'Mehta', 'Shah', 'Patel', 'Desai', 'Reddy', 'Nair',
  'Menon', 'Iyer', 'Krishnan', 'Rao', 'Joshi', 'Kulkarni', 'Deshpande', 'Bhat', 'Shetty', 'Pillai',
];

/** Company names are placeholders — no real employer is represented. */
const COMPANIES = [
  { name: 'Northwind Analytics', industry: 'Business Intelligence', size: '201-500' },
  { name: 'Vertex Retail Group', industry: 'Retail & E-commerce', size: '1001-5000' },
  { name: 'Lumen Financial Services', industry: 'Financial Services', size: '501-1000' },
  { name: 'Pixelcraft Studios', industry: 'Design & Media', size: '51-200' },
  { name: 'Cobalt Software Labs', industry: 'Software Products', size: '201-500' },
];

const BRANCHES = [
  { code: 'BBA', name: 'Bachelor of Business Administration', degree: 'BBA', years: 3 },
  { code: 'BCOM', name: 'Bachelor of Commerce', degree: 'B.Com', years: 3 },
  { code: 'BSC-CS', name: 'B.Sc. Computer Science', degree: 'B.Sc.', years: 3 },
  { code: 'BBA-DA', name: 'BBA — Business Analytics', degree: 'BBA', years: 3 },
  { code: 'BMS', name: 'Bachelor of Management Studies', degree: 'BMS', years: 3 },
];

const SKILL_CATALOGUE = [
  { category: 'Data & Analytics', skills: ['Advanced Excel', 'SQL', 'Power BI', 'Tableau', 'Statistics', 'Python', 'Data Visualization', 'Data Cleaning'] },
  { category: 'Marketing', skills: ['Digital Marketing', 'SEO', 'Social Media Marketing', 'Content Writing', 'Google Analytics', 'Brand Management'] },
  { category: 'Software Development', skills: ['JavaScript', 'React', 'Node.js', 'HTML', 'CSS', 'Git', 'REST APIs'] },
  { category: 'Business & Finance', skills: ['Financial Modelling', 'Accounting', 'Financial Analysis', 'Business Strategy', 'Market Research'] },
  { category: 'Communication', skills: ['Public Speaking', 'Business Writing', 'Presentation Skills', 'Negotiation', 'Client Communication'] },
  { category: 'Professional', skills: ['Project Management', 'Problem Solving', 'Teamwork', 'Time Management', 'Critical Thinking'] },
];

const EVENT_TEMPLATES = [
  { title: 'Advanced Excel for Business Analytics', category: 'WORKSHOP', mode: 'OFFLINE' },
  { title: 'Power BI Dashboard Bootcamp', category: 'BOOTCAMP', mode: 'OFFLINE' },
  { title: 'Introduction to SQL and Databases', category: 'WORKSHOP', mode: 'ONLINE' },
  { title: 'Data Storytelling with Visualization', category: 'SEMINAR', mode: 'ONLINE' },
  { title: 'Digital Marketing Fundamentals', category: 'WORKSHOP', mode: 'OFFLINE' },
  { title: 'SEO and Content Strategy Sprint', category: 'BOOTCAMP', mode: 'ONLINE' },
  { title: 'Resume and LinkedIn Clinic', category: 'WORKSHOP', mode: 'OFFLINE' },
  { title: 'Mock Interview Marathon', category: 'WORKSHOP', mode: 'OFFLINE' },
  { title: 'Campus Hackathon 2026', category: 'HACKATHON', mode: 'OFFLINE' },
  { title: 'Business Case Competition', category: 'COMPETITION', mode: 'OFFLINE' },
  { title: 'Financial Modelling Masterclass', category: 'SEMINAR', mode: 'ONLINE' },
  { title: 'Startup Pitch Night', category: 'COMPETITION', mode: 'OFFLINE' },
  { title: 'Public Speaking Workshop', category: 'WORKSHOP', mode: 'OFFLINE' },
  { title: 'Product Management 101', category: 'WEBINAR', mode: 'ONLINE' },
  { title: 'Annual Cultural Fest — Aarambh', category: 'FEST', mode: 'OFFLINE' },
  { title: 'Inter-College Sports Meet', category: 'SPORTS', mode: 'OFFLINE' },
  { title: 'AI Tools for Students', category: 'WEBINAR', mode: 'ONLINE' },
  { title: 'Communication Skills Bootcamp', category: 'BOOTCAMP', mode: 'OFFLINE' },
  { title: 'Placement Preparation Drive', category: 'PLACEMENT_DRIVE', mode: 'OFFLINE' },
  { title: 'Design Thinking Workshop', category: 'WORKSHOP', mode: 'OFFLINE' },
];

const COURSES = [
  { title: 'Excel for Business: Zero to Advanced', level: 'BEGINNER', duration: 420, premium: false, skills: ['Advanced Excel'], category: 'Data & Analytics' },
  { title: 'SQL for Analysts', level: 'BEGINNER', duration: 360, premium: false, skills: ['SQL'], category: 'Data & Analytics' },
  { title: 'Power BI: Build Your First Dashboard', level: 'INTERMEDIATE', duration: 300, premium: false, skills: ['Power BI', 'Data Visualization'], category: 'Data & Analytics' },
  { title: 'Data Analytics Career Track', level: 'INTERMEDIATE', duration: 900, premium: true, skills: ['Power BI', 'SQL', 'Statistics'], category: 'Data & Analytics' },
  { title: 'Digital Marketing Essentials', level: 'BEGINNER', duration: 300, premium: false, skills: ['Digital Marketing', 'Social Media Marketing'], category: 'Marketing' },
  { title: 'SEO Deep Dive', level: 'INTERMEDIATE', duration: 240, premium: true, skills: ['SEO', 'Content Writing'], category: 'Marketing' },
  { title: 'Business Communication Mastery', level: 'BEGINNER', duration: 180, premium: false, skills: ['Business Writing', 'Presentation Skills'], category: 'Communication' },
  { title: 'Financial Modelling in Excel', level: 'ADVANCED', duration: 480, premium: true, skills: ['Financial Modelling', 'Advanced Excel', 'Accounting'], category: 'Business & Finance' },
  { title: 'Web Development Foundations', level: 'BEGINNER', duration: 600, premium: false, skills: ['HTML', 'CSS', 'JavaScript'], category: 'Software Development' },
  { title: 'Interview Preparation Bootcamp', level: 'INTERMEDIATE', duration: 240, premium: true, skills: ['Public Speaking', 'Communication', 'Problem Solving'], category: 'Professional' },
];

const PROJECTS = [
  { title: 'Retail Sales Dashboard', summary: 'Build a multi-page Power BI dashboard from three years of retail transaction data.', skills: ['Power BI', 'Data Visualization', 'Advanced Excel'], difficulty: 3 },
  { title: 'Customer Churn Analysis', summary: 'Identify the drivers of churn in a telecom dataset and quantify the revenue at risk.', skills: ['SQL', 'Statistics'], difficulty: 4 },
  { title: 'Marketing Funnel Optimisation Case', summary: 'Diagnose a drop-off in a paid campaign funnel and propose a reallocation.', skills: ['Digital Marketing', 'Google Analytics'], difficulty: 3 },
  { title: 'Financial Model for a Small Business', summary: 'Build a three-statement model for a fictional café with a 3-year forecast.', skills: ['Financial Modelling', 'Accounting'], difficulty: 4 },
  { title: 'Campus Event Analytics', summary: 'Analyse two semesters of campus event data and recommend a calendar for next year.', skills: ['Advanced Excel', 'Data Cleaning'], difficulty: 2 },
  { title: 'Portfolio Website', summary: 'Build and deploy a responsive personal portfolio with a contact form.', skills: ['HTML', 'CSS', 'JavaScript'], difficulty: 2 },
];

const JOBS = [
  { title: 'Business Analyst', company: 0, salaryMin: 450_000, salaryMax: 650_000, skills: ['SQL', 'Advanced Excel', 'Power BI'], type: 'FULL_TIME', mode: 'ONSITE', location: 'Mumbai, Maharashtra', education: 'BBA' },
  { title: 'Data Analyst Intern', company: 0, salaryMin: 180_000, salaryMax: 240_000, skills: ['SQL', 'Python'], type: 'INTERNSHIP', mode: 'HYBRID', location: 'Mumbai, Maharashtra', education: 'Any' },
  { title: 'Junior Data Analyst', company: 1, salaryMin: 380_000, salaryMax: 520_000, skills: ['Advanced Excel', 'Power BI', 'SQL'], type: 'FULL_TIME', mode: 'ONSITE', location: 'Pune, Maharashtra', education: 'BBA' },
  { title: 'Category Management Trainee', company: 1, salaryMin: 320_000, salaryMax: 420_000, skills: ['Advanced Excel', 'Business Strategy'], type: 'FULL_TIME', mode: 'ONSITE', location: 'Bengaluru, Karnataka', education: 'BBA' },
  { title: 'Retail Operations Intern', company: 1, salaryMin: 150_000, salaryMax: 200_000, skills: ['Advanced Excel', 'Time Management'], type: 'INTERNSHIP', mode: 'ONSITE', location: 'Pune, Maharashtra', education: 'Any' },
  { title: 'Financial Analyst', company: 2, salaryMin: 480_000, salaryMax: 700_000, skills: ['Financial Modelling', 'Accounting', 'Advanced Excel'], type: 'FULL_TIME', mode: 'ONSITE', location: 'Mumbai, Maharashtra', education: 'B.Com' },
  { title: 'Risk and Compliance Associate', company: 2, salaryMin: 420_000, salaryMax: 560_000, skills: ['Financial Analysis', 'Business Writing'], type: 'FULL_TIME', mode: 'HYBRID', location: 'Mumbai, Maharashtra', education: 'B.Com' },
  { title: 'Finance Intern', company: 2, salaryMin: 168_000, salaryMax: 216_000, skills: ['Advanced Excel', 'Accounting'], type: 'INTERNSHIP', mode: 'ONSITE', location: 'Mumbai, Maharashtra', education: 'Any' },
  { title: 'UI/UX Design Intern', company: 3, salaryMin: 180_000, salaryMax: 240_000, skills: ['Brand Management', 'Content Writing'], type: 'INTERNSHIP', mode: 'REMOTE', location: 'Remote', education: 'Any' },
  { title: 'Social Media Executive', company: 3, salaryMin: 300_000, salaryMax: 420_000, skills: ['Social Media Marketing', 'Content Writing', 'Digital Marketing'], type: 'FULL_TIME', mode: 'HYBRID', location: 'Bengaluru, Karnataka', education: 'Any' },
  { title: 'Content Marketing Associate', company: 3, salaryMin: 336_000, salaryMax: 456_000, skills: ['Content Writing', 'SEO', 'Digital Marketing'], type: 'FULL_TIME', mode: 'REMOTE', location: 'Remote', education: 'Any' },
  { title: 'Associate Software Engineer', company: 4, salaryMin: 600_000, salaryMax: 850_000, skills: ['JavaScript', 'React', 'Node.js', 'Git'], type: 'FULL_TIME', mode: 'ONSITE', location: 'Hyderabad, Telangana', education: 'B.Sc.' },
  { title: 'Frontend Developer Intern', company: 4, salaryMin: 240_000, salaryMax: 300_000, skills: ['JavaScript', 'React', 'CSS'], type: 'INTERNSHIP', mode: 'REMOTE', location: 'Remote', education: 'Any' },
  { title: 'Product Analyst', company: 4, salaryMin: 540_000, salaryMax: 720_000, skills: ['SQL', 'Data Visualization', 'Problem Solving'], type: 'FULL_TIME', mode: 'HYBRID', location: 'Hyderabad, Telangana', education: 'BBA' },
  { title: 'Business Development Executive', company: 1, salaryMin: 360_000, salaryMax: 480_000, skills: ['Negotiation', 'Client Communication', 'Business Strategy'], type: 'FULL_TIME', mode: 'ONSITE', location: 'Delhi NCR', education: 'BBA' },
];

const TESTIMONIALS = [
  {
    name: 'Ananya Deshpande',
    detail: 'BBA, Class of 2025 — placed at a retail analytics firm',
    quote:
      'Every workshop I attended fed straight into my passport. By the time I applied, I had seven verified certificates and two reviewed projects — the interview was mostly about those.',
    rating: 5,
  },
  {
    name: 'Rohan Kulkarni',
    detail: 'B.Com, Class of 2025 — finance analyst',
    quote:
      'The readiness score showed me exactly what was missing. It sat at 41 until I did a mock interview, and that conversation changed how I answered everything after it.',
    rating: 5,
  },
  {
    name: 'Sneha Iyer',
    detail: 'B.Sc. Computer Science, final year',
    quote:
      'I stopped keeping a spreadsheet of my certificates. The verification link settled the one question recruiters kept asking — whether the certificates were real.',
    rating: 4,
  },
];

/* -------------------------------------------------------------------------- */
/* Seed                                                                       */
/* -------------------------------------------------------------------------- */

async function main(): Promise<void> {
  console.log('\n🌱 Seeding CampusConnect\n');

  const startedAt = Date.now();

  // bcrypt at cost 12 is slow by design; hashing once and reusing the digest keeps
  // the seed under a minute instead of several.
  const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 12);
  console.log('   Password hash ready');

  await truncate();

  const globalRole = await prisma.role.upsert({
    where: { key: 'SUPER_ADMIN' },
    create: {
      key: 'SUPER_ADMIN',
      name: 'Platform Super Admin',
      description: 'Operates the platform across all colleges and employers.',
      layer: 'core',
      selfSignup: false,
      sortOrder: 0,
    },
    update: {},
  });

  const roleRows = await Promise.all(
    (
      [
        ['STUDENT', 'Student', 'Primary user — campus life through to placement.', 'campusconnect', true, 1],
        ['CLUB_LEAD', 'Club Lead', 'Runs club activities and manages event participation.', 'campusconnect', false, 2],
        ['FACULTY_COORDINATOR', 'Faculty Coordinator', 'Approves events and mentors student initiatives.', 'campusconnect', false, 3],
        ['COLLEGE_ADMIN', 'College Admin / Placement Officer', 'Manages the institution, certificates and readiness.', 'campusconnect', false, 4],
        ['TRAINER', 'Trainer / Career Mentor', 'Creates courses, reviews projects, runs mock interviews.', 'skillbridge', false, 5],
        ['EMPLOYER', 'Employer / Recruiter', 'Posts opportunities and hires ready candidates.', 'careerconnect', false, 6],
      ] as const
    ).map(([key, name, description, layer, selfSignup, sortOrder]) =>
      prisma.role.upsert({
        where: { key },
        create: { key, name, description, layer, selfSignup, sortOrder },
        update: { name, description },
      }),
    ),
  );

  const roleByKey = new Map(roleRows.map((row) => [row.key, row.id]));
  roleByKey.set('SUPER_ADMIN', globalRole.id);

  console.log(`   ${roleRows.length + 1} roles`);

  /* ---------------------------------------------------------------------- */
  /* Colleges and departments                                                */
  /* ---------------------------------------------------------------------- */

  const xyz = await prisma.college.create({
    data: {
      name: 'XYZ College of Business and Technology',
      shortName: 'XYZ College',
      slug: 'xyz-college',
      city: 'Pune',
      state: 'Maharashtra',
      website: 'https://xyzcollege.example.edu.in',
      placementEmail: 'placements@xyzcollege.example.edu.in',
      placementPhone: '+91 20 4000 1234',
      isActive: true,
      isPilot: true,
    },
  });

  const sunrise = await prisma.college.create({
    data: {
      name: 'Sunrise Institute of Management Studies',
      shortName: 'Sunrise Institute',
      slug: 'sunrise-institute',
      city: 'Nagpur',
      state: 'Maharashtra',
      website: 'https://sunrise.example.edu.in',
      placementEmail: 'placement@sunrise.example.edu.in',
      isActive: true,
      isPilot: true,
    },
  });

  const xyzDepartments = await Promise.all(
    BRANCHES.map((branch, index) =>
      prisma.department.create({
        data: {
          collegeId: xyz.id,
          name: branch.name,
          code: branch.code,
          degree: branch.degree,
          durationYears: branch.years,
          isActive: true,
          hodName: index === 0 ? 'Dr. Sunita Kulkarni' : undefined,
        },
      }),
    ),
  );

  const sunriseDepartments = await Promise.all(
    BRANCHES.slice(0, 3).map((branch) =>
      prisma.department.create({
        data: {
          collegeId: sunrise.id,
          name: branch.name,
          code: branch.code,
          degree: branch.degree,
          durationYears: branch.years,
          isActive: true,
        },
      }),
    ),
  );

  console.log(`   2 colleges, ${xyzDepartments.length + sunriseDepartments.length} departments`);

  /* ---------------------------------------------------------------------- */
  /* Skills                                                                  */
  /* ---------------------------------------------------------------------- */

  const skillRows = await Promise.all(
    SKILL_CATALOGUE.map(async (group, groupIndex) => {
      const category = await prisma.skillCategory.upsert({
        where: { slug: slugify(group.category) },
        create: {
          name: group.category,
          slug: slugify(group.category),
          sortOrder: groupIndex,
          colorToken: ['blue', 'violet', 'emerald', 'amber', 'rose', 'cyan'][groupIndex % 6]!,
        },
        update: {},
      });

      const skills = await Promise.all(
        group.skills.map((skill) =>
          prisma.skill.create({
            data: {
              categoryId: category.id,
              name: skill,
              slug: slugify(skill),
              // Platform-global skills, so they are shared across tenants.
              collegeId: null,
              expectedLevel: 'INTERMEDIATE',
              isActive: true,
            },
          }),
        ),
      );

      return { category, skills };
    }),
  );

  const allSkills = skillRows.flatMap((group) => group.skills);
  const skillByName = new Map(allSkills.map((skill) => [skill.name, skill]));

  console.log(`   ${skillRows.length} skill categories, ${allSkills.length} skills`);

  /* ---------------------------------------------------------------------- */
  /* Super admin                                                             */
  /* ---------------------------------------------------------------------- */

  const superAdmin = await prisma.user.create({
    data: {
      email: 'admin@campusconnect.example',
      username: 'platform-admin',
      passwordHash,
      fullName: 'Platform Administrator',
      role: 'SUPER_ADMIN',
      roleId: roleByKey.get('SUPER_ADMIN'),
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
      acceptedTermsAt: new Date(),
      tokenVersion: 0,
    },
  });

  /* ---------------------------------------------------------------------- */
  /* XYZ College staff                                                       */
  /* ---------------------------------------------------------------------- */

  const collegeAdmin = await prisma.user.create({
    data: {
      email: 'placement.officer@xyzcollege.example.edu.in',
      username: 'meera-iyer',
      passwordHash,
      fullName: 'Meera Iyer',
      phone: '+91 98200 11223',
      role: 'COLLEGE_ADMIN',
      roleId: roleByKey.get('COLLEGE_ADMIN'),
      collegeId: xyz.id,
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
      acceptedTermsAt: new Date(),
    },
  });

  const facultyCoordinator = await prisma.user.create({
    data: {
      email: 'faculty@xyzcollege.example.edu.in',
      username: 'arun-mehta',
      passwordHash,
      fullName: 'Prof. Arun Mehta',
      role: 'FACULTY_COORDINATOR',
      roleId: roleByKey.get('FACULTY_COORDINATOR'),
      collegeId: xyz.id,
      departmentId: xyzDepartments[0]!.id,
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
      acceptedTermsAt: new Date(),
    },
  });

  const courseTrainer = await prisma.user.create({
    data: {
      email: 'trainer@campusconnect.example',
      username: 'vikram-rao',
      passwordHash,
      fullName: 'Vikram Rao',
      role: 'TRAINER',
      roleId: roleByKey.get('TRAINER'),
      collegeId: xyz.id,
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
      acceptedTermsAt: new Date(),
    },
  });

  /* ---------------------------------------------------------------------- */
  /* Employers                                                               */
  /* ---------------------------------------------------------------------- */

  const employers = await Promise.all(
    COMPANIES.map(async (company, index) => {
      const user = await prisma.user.create({
        data: {
          email: `hiring@${slugify(company.name)}.example`,
          username: slugify(`${company.name}-hiring`),
          passwordHash,
          fullName: `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`,
          role: 'EMPLOYER',
          roleId: roleByKey.get('EMPLOYER'),
          status: 'ACTIVE',
          emailVerifiedAt: new Date(),
          acceptedTermsAt: new Date(),
        },
      });

      const profile = await prisma.employerProfile.create({
        data: {
          userId: user.id,
          companyName: company.name,
          slug: slugify(company.name),
          industry: company.industry,
          companySize: company.size,
          headquarters: index === 0 ? 'Mumbai' : index === 1 ? 'Bengaluru' : 'Pune',
          website: `https://${slugify(company.name)}.example.com`,
          about: `${company.name} is a placeholder employer profile seeded for demonstration. ${company.industry} organisation with ${company.size} employees.`,
          // The first four are verified so candidate search is demonstrable; the
          // fifth stays pending so the "awaiting verification" state is visible.
          isVerified: index < 4,
          verifiedAt: index < 4 ? new Date() : null,
          verifiedByUserId: index < 4 ? superAdmin.id : null,
          contactName: 'Talent Acquisition',
          contactEmail: `talent@${slugify(company.name)}.example.com`,
        },
      });

      return { user, profile, index };
    }),
  );

  console.log(`   ${employers.length} employers (4 verified, 1 pending)`);

  /* ---------------------------------------------------------------------- */
  /* Students                                                                */
  /* ---------------------------------------------------------------------- */

  /**
   * Rahul Sharma is the example persona from the brief: BBA, XYZ College, with a
   * deliberately rich profile — a completed internship, approved projects, verified
   * skills and mock interviews — so the passport demo shows a realistic senior
   * student rather than an empty shell.
   */
  const rahul = await prisma.user.create({
    data: {
      email: 'rahul.sharma@xyzcollege.example.edu.in',
      username: 'rahul-sharma',
      passwordHash,
      fullName: 'Rahul Sharma',
      phone: '+91 98765 43210',
      role: 'STUDENT',
      roleId: roleByKey.get('STUDENT'),
      collegeId: xyz.id,
      departmentId: xyzDepartments[0]!.id,
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
      acceptedTermsAt: new Date(),
      // Opted in, so the employer-search demo has a candidate.
      consentToEmployerSearch: true,
      bio: 'Final-year BBA student focused on business analytics. Power BI and advanced Excel, with a reviewed capstone on retail demand forecasting. Looking for a data analyst role where I can turn messy operational data into decisions.',
    },
  });

  const rahulProfile = await prisma.studentProfile.create({
    data: {
      userId: rahul.id,
      collegeId: xyz.id,
      departmentId: xyzDepartments[0]!.id,
      rollNumber: 'XYZ-BBA-2022-014',
      degree: 'BBA',
      graduationYear: new Date().getFullYear() + 1,
      cgpa: 8.4,
      headline: 'Business Analytics · Power BI · SQL',
      location: 'Pune, Maharashtra',
      linkedinUrl: 'https://linkedin.com/in/rahul-sharma-example',
      githubUrl: 'https://github.com/rahul-sharma-example',
      portfolioUrl: 'https://rahul-sharma.example.dev',
      careerInterests: ['Data Analyst', 'Business Analyst', 'Product Analyst'],
      passportVisibility: 'EMPLOYERS_ONLY',
      readinessScore: 0,
    },
  });

  // --- The remaining students ------------------------------------------------
  const studentSeeds: {
    id: string;
    profileId: string;
    fullName: string;
    collegeId: string;
    departmentId: string;
    graduationYear: number;
    email: string;
  }[] = [];

  const batches = [
    { graduationYear: new Date().getFullYear(), weight: 0.25 },
    { graduationYear: new Date().getFullYear() + 1, weight: 0.4 },
    { graduationYear: new Date().getFullYear() + 2, weight: 0.35 },
  ];

  const usedNames = new Set<string>(['Rahul Sharma']);
  let studentIndex = 0;

  for (const batch of batches) {
    const count = Math.round(48 * batch.weight);

    for (let i = 0; i < count; i += 1) {
      let fullName: string;
      do {
        fullName = `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
      } while (usedNames.has(fullName));
      usedNames.add(fullName);

      // The two colleges split roughly 70/30, so aggregate charts have a
      // meaningful comparison.
      const atXyz = rng() < 0.7;
      const collegeId = atXyz ? xyz.id : sunrise.id;
      const departments = atXyz ? xyzDepartments : sunriseDepartments;
      const department = pick(departments);
      const emailSlug = slugify(fullName);

      const user = await prisma.user.create({
        data: {
          email: `${emailSlug}.${studentIndex}@${atXyz ? 'xyzcollege' : 'sunrise'}.example.edu.in`,
          username: emailSlug,
          passwordHash,
          fullName,
          phone: chance(0.7) ? `+91 ${intBetween(70, 99)}${intBetween(100, 999)} ${intBetween(10000, 99999)}` : null,
          role: 'STUDENT',
          roleId: roleByKey.get('STUDENT'),
          collegeId,
          departmentId: department.id,
          status: 'ACTIVE',
          emailVerifiedAt: new Date(),
          acceptedTermsAt: new Date(),
          // Consent is genuinely opt-in, so only a subset of students are visible to
          // employers. This is what makes the consent model demonstrable rather than
          // decorative.
          consentToEmployerSearch: chance(0.55),
          lastLoginAt: chance(0.8) ? daysFromNow(-intBetween(0, 30), intBetween(8, 22)) : null,
        },
      });

      const profile = await prisma.studentProfile.create({
        data: {
          userId: user.id,
          collegeId,
          departmentId: department.id,
          rollNumber: `${department.code}-${batch.graduationYear}-${String(studentIndex).padStart(3, '0')}`,
          degree: department.code.startsWith('BBA') || department.code === 'BMS' ? 'BBA' : department.code,
          graduationYear: batch.graduationYear,
          cgpa: Math.round((6.2 + rng() * 3.4) * 10) / 10,
          headline: pick([
            'Aspiring business analyst',
            'Final-year student · marketing',
            'Data and dashboards',
            'Looking for a finance internship',
            'Frontend developer in training',
            'Commerce graduate track',
            null,
          ]),
          location: atXyz ? 'Pune, Maharashtra' : 'Nagpur, Maharashtra',
          careerInterests: pickMany(
            ['Data Analyst', 'Business Analyst', 'Digital Marketing', 'Finance', 'Product', 'Software Development', 'HR', 'Consulting'],
            intBetween(1, 3),
          ),
          passportVisibility: chance(0.15) ? 'PUBLIC' : chance(0.9) ? 'EMPLOYERS_ONLY' : 'PRIVATE',
          readinessScore: 0,
        },
      });

      studentSeeds.push({
        id: user.id,
        profileId: profile.id,
        fullName,
        collegeId,
        departmentId: department.id,
        graduationYear: batch.graduationYear,
        email: user.email,
      });

      studentIndex += 1;
    }
  }

  const allStudents = [
    {
      id: rahul.id,
      profileId: rahulProfile.id,
      fullName: 'Rahul Sharma',
      collegeId: xyz.id,
      departmentId: xyzDepartments[0]!.id,
      graduationYear: new Date().getFullYear() + 1,
      email: rahul.email,
    },
    ...studentSeeds,
  ];

  console.log(`   ${allStudents.length} students (including Rahul Sharma)`);

  /* ---------------------------------------------------------------------- */
  /* Clubs                                                                   */
  /* ---------------------------------------------------------------------- */

  const clubDefinitions = [
    { name: 'Analytics and Insights Club', category: 'PROFESSIONAL', collegeId: xyz.id, description: 'Student-run analytics community. Weekly dashboard clinics, case-study sessions and an annual data fest. Open to all branches.' },
    { name: 'Entrepreneurship Cell', category: 'ENTREPRENEURSHIP', collegeId: xyz.id, description: 'Supports student founders with mentorship, pitch practice and an incubation fund. Runs the annual Startup Pitch Night.' },
    { name: 'Marketing and Brand Cell', category: 'PROFESSIONAL', collegeId: xyz.id, description: 'Handles campus brand campaigns and social media. Members build real campaign portfolios they can show employers.' },
    { name: 'Literary and Debate Society', category: 'LITERARY', collegeId: xyz.id, description: 'Debates, Model UN and public speaking. Weekly practice sessions and inter-college tournaments.' },
    { name: 'Cultural Committee — Aarambh', category: 'CULTURAL', collegeId: xyz.id, description: 'Organises the annual cultural fest. Volunteer roles across stage, hospitality, sponsorship and social media.' },
    { name: 'Coding Club', category: 'TECHNICAL', collegeId: xyz.id, description: 'Competitive programming, open-source contributions and hackathon preparation.' },
    { name: 'Finance and Investment Club', category: 'PROFESSIONAL', collegeId: xyz.id, description: 'Stock market simulations, financial modelling workshops and guest sessions from industry practitioners.' },
    { name: 'Sports Council', category: 'SPORTS', collegeId: sunrise.id, description: 'Inter-college tournaments and fitness programmes.' },
    { name: 'Business Analytics Club', category: 'PROFESSIONAL', collegeId: sunrise.id, description: 'Data literacy workshops and case competitions.' },
  ];

  const xyzStudents = allStudents.filter((student) => student.collegeId === xyz.id);
  const sunriseStudents = allStudents.filter((student) => student.collegeId === sunrise.id);

  const clubs = await Promise.all(
    clubDefinitions.map(async (definition) => {
      const pool = definition.collegeId === xyz.id ? xyzStudents : sunriseStudents;
      const president = pick(pool);

      return prisma.club.create({
        data: {
          collegeId: definition.collegeId,
          name: definition.name,
          slug: slugify(definition.name),
          category: definition.category,
          description: definition.description,
          email: `${slugify(definition.name).slice(0, 20)}@example.edu.in`,
          meetingSchedule: pick(['Every Wednesday, 5:00 PM', 'Alternate Fridays, 4:30 PM', 'Every Tuesday, 5:30 PM']),
          isRecruiting: chance(0.75),
          isActive: true,
          presidentId: president.id,
        },
      });
    }),
  );

  // Rahul leads the analytics club, which is what gives his passport a leadership
  // entry rather than only attendance records.
  await prisma.club.update({
    where: { id: clubs[0]!.id },
    data: { presidentId: rahul.id },
  });

  console.log(`   ${clubs.length} clubs`);

  /* ---------------------------------------------------------------------- */
  /* Club memberships                                                        */
  /* ---------------------------------------------------------------------- */

  let membershipCount = 0;

  for (const club of clubs) {
    const pool = club.collegeId === xyz.id ? xyzStudents : sunriseStudents;
    const memberCount = intBetween(8, 22);
    const members = pickMany(pool, Math.min(memberCount, pool.length));

    for (const member of members) {
      const isPresident = club.presidentId === member.id;
      // A realistic club has a handful of pending requests sitting in the queue.
      const status = isPresident || chance(0.88) ? 'ACTIVE' : chance(0.5) ? 'PENDING' : 'REJECTED';

      await prisma.clubMembership.create({
        data: {
          clubId: club.id,
          userId: member.id,
          collegeId: club.collegeId,
          departmentId: member.departmentId,
          role: isPresident ? 'PRESIDENT' : chance(0.25) ? 'CORE_TEAM' : 'MEMBER',
          status,
          joinedAt: status === 'ACTIVE' ? daysFromNow(-intBetween(30, 300), 12) : null,
          message: status === 'PENDING' ? 'I would like to help organise the next workshop series.' : null,
          reviewedAt: status !== 'PENDING' ? daysFromNow(-intBetween(10, 200), 12) : null,
          reviewedById: status !== 'PENDING' ? collegeAdmin.id : null,
        },
      });

      if (status === 'ACTIVE') membershipCount += 1;
    }

    const activeCount = await prisma.clubMembership.count({
      where: { clubId: club.id, status: 'ACTIVE' },
    });

    await prisma.club.update({ where: { id: club.id }, data: { memberCount: activeCount } });
  }

  console.log(`   ${membershipCount} active club memberships`);

  /* ---------------------------------------------------------------------- */
  /* Certificate templates                                                   */
  /* ---------------------------------------------------------------------- */

  const participationTemplate = await prisma.certificateTemplate.create({
    data: {
      collegeId: xyz.id,
      name: 'Event Participation — Standard',
      type: 'EVENT_PARTICIPATION',
      bodyTemplate:
        'This is to certify that {{studentName}} of {{collegeName}} participated in {{eventTitle}} held on {{eventDates}}.\n\nCertificate ID: {{certificateId}}\nIssued on: {{issuedOn}}',
      primaryColor: '#2563EB',
      signatoryName: 'Prof. Arun Mehta',
      signatoryTitle: 'Faculty Coordinator',
      signatureLabel: 'Faculty Coordinator',
      isActive: true,
      isDefault: true,
    },
  });

  const achievementTemplate = await prisma.certificateTemplate.create({
    data: {
      collegeId: xyz.id,
      name: 'Achievement — Competition',
      type: 'EVENT_WINNER',
      bodyTemplate:
        'This is to certify that {{studentName}} of {{collegeName}} secured {{position}} in {{eventTitle}} held on {{eventDates}}.\n\nCertificate ID: {{certificateId}}\nIssued on: {{issuedOn}}',
      primaryColor: '#4F46E5',
      signatoryName: 'Dr. Sunita Kulkarni',
      signatoryTitle: 'Head of Department',
      signatureLabel: 'Head of Department',
      isActive: true,
      isDefault: false,
    },
  });

  await prisma.certificateTemplate.create({
    data: {
      collegeId: sunrise.id,
      name: 'Event Participation — Sunrise',
      type: 'EVENT_PARTICIPATION',
      bodyTemplate:
        'This is to certify that {{studentName}} of {{collegeName}} participated in {{eventTitle}} on {{eventDates}}.\n\nCertificate ID: {{certificateId}}',
      primaryColor: '#0D9488',
      signatoryName: 'Dr. R. Nair',
      signatoryTitle: 'Principal',
      isActive: true,
      isDefault: true,
    },
  });

  console.log('   3 certificate templates');

  /* ---------------------------------------------------------------------- */
  /* Events                                                                  */
  /* ---------------------------------------------------------------------- */

  type SeededEvent = {
    id: string;
    title: string;
    startAt: Date;
    endAt: Date;
    status: string;
    capacity: number;
    collegeId: string;
    isPast: boolean;
  };

  const seededEvents: SeededEvent[] = [];

  // 13 past events (with attendance and certificates) and 7 upcoming.
  for (let i = 0; i < EVENT_TEMPLATES.length; i += 1) {
    const template = EVENT_TEMPLATES[i]!;
    const isPast = i < 13;

    const offset = isPast ? -intBetween(7, 120) : intBetween(2, 55);
    const startAt = daysFromNow(offset, pick([10, 11, 14, 15, 17]));
    const endAt = new Date(startAt.getTime() + intBetween(2, 6) * 60 * 60 * 1000);

    // Two events sit in the approval queue so the reviewer dashboard is populated.
    const status = isPast
      ? 'COMPLETED'
      : i === 13
        ? 'PENDING_FACULTY'
        : i === 14
          ? 'PENDING_ADMIN'
          : i === 15
            ? 'DRAFT'
            : 'PUBLISHED';

    const collegeId = chance(0.8) ? xyz.id : sunrise.id;
    const departments = collegeId === xyz.id ? xyzDepartments : sunriseDepartments;
    const club = chance(0.6) ? pick(clubs.filter((c) => c.collegeId === collegeId)) : null;
    const capacity = template.category === 'FEST' ? 500 : intBetween(40, 160);

    const event = await prisma.event.create({
      data: {
        collegeId,
        slug: `${slugify(template.title)}-${i + 1}`,
        title: template.title,
        summary: `${template.title} — a ${template.category.toLowerCase().replace('_', ' ')} for students across all branches.`,
        description:
          `${template.title}\n\n` +
          `This ${template.category.toLowerCase().replace(/_/g, ' ')} is designed for students who want practical, ` +
          `employer-relevant experience rather than theory. You will work through real examples, get feedback from ` +
          `practitioners, and leave with something concrete to add to your Career Passport.\n\n` +
          `What you will take away:\n` +
          `• Hands-on practice with the tools used in industry\n` +
          `• A reviewed piece of work for your portfolio\n` +
          `• A verified certificate you can share with employers\n\n` +
          `No prior experience is required. Bring a laptop if you have one — we provide backup machines.`,
        category: template.category,
        mode: template.mode,
        status,
        venue: template.mode === 'ONLINE' ? null : pick(['Seminar Hall A', 'Auditorium', 'Lab 204', 'Innovation Centre', 'Main Auditorium']),
        meetingUrl: template.mode === 'ONLINE' ? `https://meet.example.com/${slugify(template.title)}` : null,
        startAt,
        endAt,
        registrationDeadline: isPast ? new Date(startAt.getTime() - 2 * 24 * 60 * 60 * 1000) : chance(0.7) ? new Date(startAt.getTime() - intBetween(1, 5) * 24 * 60 * 60 * 1000) : null,
        capacity,
        waitlistEnabled: true,
        // Most events are free; a few are paid so the paid flow is represented.
        fee: chance(0.2) ? pick([9900, 19900, 29900]) : 0,
        currency: 'INR',
        certificateEnabled: true,
        certificateTemplateId:
          template.category === 'COMPETITION' || template.category === 'HACKATHON'
            ? achievementTemplate.id
            : participationTemplate.id,
        clubId: club?.id ?? null,
        departmentId: null,
        eligibleYears: chance(0.25) ? pickMany([1, 2, 3], 1) : [],
        tags: pickMany(
          ['analytics', 'excel', 'power-bi', 'sql', 'marketing', 'career', 'communication', 'finance', 'coding', 'design', 'certificate'],
          intBetween(2, 4),
        ),
        organizerId: club?.presidentId ?? pick([facultyCoordinator.id, courseTrainer.id, collegeAdmin.id]),
        contactEmail: 'events@xyzcollege.example.edu.in',
        publishedAt: status === 'PUBLISHED' || status === 'COMPLETED' ? new Date(startAt.getTime() - 14 * 24 * 60 * 60 * 1000) : null,
        completedAt: status === 'COMPLETED' ? endAt : null,
      },
    });

    seededEvents.push({
      id: event.id,
      title: event.title,
      startAt,
      endAt,
      status,
      capacity,
      collegeId,
      isPast,
    });

    // Approval history, so the timeline on a detail page has content.
    if (status !== 'DRAFT') {
      if (status === 'PENDING_ADMIN' || status === 'PUBLISHED' || status === 'COMPLETED') {
        await prisma.eventApproval.create({
          data: {
            eventId: event.id,
            stage: 'FACULTY',
            decision: 'APPROVE',
            note: 'Content and schedule look good. Cleared for admin review.',
            actorId: facultyCoordinator.id,
            resultingStatus: status === 'PENDING_ADMIN' ? 'PENDING_ADMIN' : 'PENDING_ADMIN',
            createdAt: new Date(startAt.getTime() - 20 * 24 * 60 * 60 * 1000),
          },
        });
      }
      if (status === 'PUBLISHED' || status === 'COMPLETED') {
        await prisma.eventApproval.create({
          data: {
            eventId: event.id,
            stage: 'ADMIN',
            decision: 'APPROVE',
            note: 'Approved and published.',
            actorId: collegeAdmin.id,
            resultingStatus: 'PUBLISHED',
            createdAt: new Date(startAt.getTime() - 16 * 24 * 60 * 60 * 1000),
          },
        });
      }
      if (status === 'PENDING_FACULTY') {
        await prisma.eventApproval.create({
          data: {
            eventId: event.id,
            stage: 'FACULTY',
            decision: 'APPROVE',
            note: null,
            actorId: pick([facultyCoordinator.id, courseTrainer.id]),
            resultingStatus: 'PENDING_FACULTY',
            createdAt: daysFromNow(-intBetween(1, 5), 12),
          },
        });
      }
    }
  }

  console.log(`   ${seededEvents.length} events (13 past, 7 upcoming)`);

  /* ---------------------------------------------------------------------- */
  /* Registrations, attendance and certificates                              */
  /* ---------------------------------------------------------------------- */

  let registrationCount = 0;
  let attendanceCount = 0;
  let certificateCount = 0;

  for (const event of seededEvents) {
    const pool = allStudents.filter((student) => student.collegeId === event.collegeId);
    if (pool.length === 0) continue;

    // Upcoming events have partial registration; past events have a fuller roster.
    const targetRegistrations = event.isPast
      ? Math.min(pool.length, Math.round(event.capacity * (0.5 + rng() * 0.45)))
      : Math.min(pool.length, Math.round(event.capacity * (0.2 + rng() * 0.5)));

    const registrants = pickMany(pool, Math.max(1, targetRegistrations));
    let confirmedSoFar = 0;

    for (const student of registrants) {
      // Capacity is respected: once full, subsequent registrants are waitlisted.
      const isFull = event.capacity > 0 && confirmedSoFar >= event.capacity;
      const status = isFull
        ? 'WAITLISTED'
        : event.isPast
          ? 'ATTENDED'
          : chance(0.92)
            ? 'CONFIRMED'
            : chance(0.5)
              ? 'WAITLISTED'
              : 'CANCELLED';

      if (status !== 'WAITLISTED' && status !== 'CANCELLED') confirmedSoFar += 1;

      const registeredAt = new Date(
        event.startAt.getTime() - intBetween(1, 20) * 24 * 60 * 60 * 1000,
      );

      const registration = await prisma.eventRegistration.create({
        data: {
          eventId: event.id,
          studentId: student.id,
          collegeId: event.collegeId,
          status,
          passCode: passCode(),
          waitlistPosition: status === 'WAITLISTED' ? intBetween(1, 12) : null,
          registeredAt,
          cancelledAt: status === 'CANCELLED' ? new Date(registeredAt.getTime() + 86_400_000) : null,
          cancelReason: status === 'CANCELLED' ? 'Schedule clash' : null,
          paymentReference: null,
          amountPaid: 0,
        },
      });

      registrationCount += 1;

      /* --- Attendance, only for past events -------------------------------
       * The generator deliberately produces a realistic no-show rate (~15–25%)
       * rather than perfect attendance, because an attendance-rate chart where
       * every event is at 100% teaches nothing.
       */
      if (!event.isPast) continue;
      if (status === 'CANCELLED') continue;

      const attended = status === 'ATTENDED' && chance(0.85);

      if (!attended) {
        if (status === 'ATTENDED') {
          await prisma.eventRegistration.update({
            where: { id: registration.id },
            data: { status: 'NO_SHOW' },
          });
        }
        continue;
      }

      const markedAt = new Date(event.startAt.getTime() + intBetween(-20, 30) * 60 * 1000);

      await prisma.attendance.create({
        data: {
          eventId: event.id,
          studentId: student.id,
          registrationId: registration.id,
          collegeId: event.collegeId,
          method: chance(0.85) ? 'QR_SCAN' : 'MANUAL',
          markedAt,
          scannedById: chance(0.8) ? facultyCoordinator.id : collegeAdmin.id,
          reason: chance(0.15) ? 'Phone battery died; verified against the registration list.' : null,
          deviceLabel: chance(0.5) ? 'Front desk tablet' : 'Main gate scanner',
        },
      });

      attendanceCount += 1;

      /* --- Certificate for attendance -------------------------------------
       * Only for events with certificates enabled, and with a small failure rate
       * so the "certificate pending" state is represented.
       */
      if (!chance(0.9)) continue;

      const isWinner = (event.title.includes('Competition') || event.title.includes('Hackathon')) && chance(0.08);

      await prisma.certificate.create({
        data: {
          certificateId: certificateId(event.startAt.getFullYear()),
          studentId: student.id,
          collegeId: event.collegeId,
          templateId: isWinner ? achievementTemplate.id : participationTemplate.id,
          type: isWinner ? 'EVENT_WINNER' : 'EVENT_PARTICIPATION',
          status: 'ISSUED',
          title: isWinner ? `${event.title} — Winner` : `Certificate of Participation — ${event.title}`,
          description: null,
          position: isWinner ? pick(['Winner', 'Runner-up', 'Second Runner-up']) : null,
          eventId: event.id,
          registrationId: registration.id,
          issuedById: facultyCoordinator.id,
          issuedAt: new Date(event.endAt.getTime() + intBetween(4, 72) * 60 * 60 * 1000),
          emailedAt: chance(0.95) ? new Date(event.endAt.getTime() + intBetween(4, 72) * 60 * 60 * 1000) : null,
        },
      });

      certificateCount += 1;
    }

    // Recompute the event counters from the rows just written.
    const [confirmed, waitlisted, attendedTotal, certs] = await Promise.all([
      prisma.eventRegistration.count({
        where: { eventId: event.id, status: { in: ['CONFIRMED', 'ATTENDED'] } },
      }),
      prisma.eventRegistration.count({ where: { eventId: event.id, status: 'WAITLISTED' } }),
      prisma.attendance.count({ where: { eventId: event.id, revokedAt: null } }),
      prisma.certificate.count({ where: { eventId: event.id, status: 'ISSUED' } }),
    ]);

    await prisma.event.update({
      where: { id: event.id },
      data: {
        registrationCount: confirmed + attendedTotal,
        waitlistCount: waitlisted,
        attendanceCount: attendedTotal,
        certificateCount: certs,
      },
    });
  }

  console.log(`   ${registrationCount} registrations, ${attendanceCount} attendance records`);
  console.log(`   ${certificateCount} certificates`);

  /* ---------------------------------------------------------------------- */
  /* Feedback                                                                */
  /* ---------------------------------------------------------------------- */

  let feedbackCount = 0;

  for (const event of seededEvents.filter((e) => e.isPast)) {
    const attendees = await prisma.attendance.findMany({
      where: { eventId: event.id, revokedAt: null },
      select: { studentId: true },
      take: 40,
    });

    // Roughly 40% of attendees leave feedback — a realistic response rate.
    const responders = attendees.filter(() => chance(0.4));

    for (const attendee of responders) {
      const rating = chance(0.62) ? 5 : chance(0.7) ? 4 : chance(0.6) ? 3 : 2;

      await prisma.feedback.create({
        data: {
          eventId: event.id,
          authorId: attendee.studentId,
          collegeId: event.collegeId,
          rating,
          contentRating: Math.max(1, Math.min(5, rating + intBetween(-1, 1))),
          speakerRating: Math.max(1, Math.min(5, rating + intBetween(-1, 1))),
          organizationRating: Math.max(1, Math.min(5, rating + intBetween(-1, 1))),
          comment:
            rating >= 4
              ? pick([
                  'Genuinely practical. I used what I learned the following week in a club project.',
                  'The pace was right and the examples were from real companies, not textbook ones.',
                  'Best session I have attended this semester. The mentor answered every question.',
                  'Clear, well organised, and I left with something concrete for my portfolio.',
                ])
              : pick([
                  'Useful content, but it moved too quickly for beginners.',
                  'Good session overall. The room was crowded and the Wi-Fi kept dropping.',
                  'I expected more hands-on practice and less presentation.',
                ]),
          suggestions: chance(0.3)
            ? pick([
                'Start with a short pre-read so the session can go deeper.',
                'Add a recorded version for students who miss it.',
                'Give more time for the Q&A at the end.',
                'Split the advanced content into a separate follow-up session.',
              ])
            : null,
          wouldRecommend: rating >= 4,
          anonymous: chance(0.15),
        },
      });

      feedbackCount += 1;
    }

    const aggregate = await prisma.feedback.aggregate({
      where: { eventId: event.id, isHidden: false, deletedAt: null },
      _avg: { rating: true },
      _count: { rating: true },
    });

    await prisma.event.update({
      where: { id: event.id },
      data: {
        averageRating: aggregate._avg.rating ?? null,
        feedbackCount: aggregate._count.rating,
      },
    });
  }

  console.log(`   ${feedbackCount} feedback responses`);

  /* ---------------------------------------------------------------------- */
  /* Courses, modules and lessons                                            */
  /* ---------------------------------------------------------------------- */

  const courses = await Promise.all(
    COURSES.map(async (definition, index) => {
      const course = await prisma.course.create({
        data: {
          collegeId: index < 8 ? xyz.id : null,
          title: definition.title,
          slug: slugify(definition.title),
          summary: `${definition.title} — a ${definition.level.toLowerCase()} course with practical exercises and a completion certificate.`,
          description:
            `${definition.title}\n\n` +
            `This course takes you from the fundamentals through to applying the skill on real data. ` +
            `Each module ends with a short exercise, and the final module is a graded project you can add to your portfolio.\n\n` +
            `You will finish able to use ${definition.skills.join(', ')} confidently in a workplace setting.`,
          level: definition.level as never,
          category: definition.category,
          language: 'English',
          durationMinutes: definition.duration,
          authorId: courseTrainer.id,
          isPremium: definition.premium,
          price: definition.premium ? pick([49900, 79900, 99900]) : 0,
          currency: 'INR',
          isPublished: true,
          publishedAt: daysFromNow(-intBetween(30, 200), 12),
          enrollCount: intBetween(18, 180),
          completionCount: intBetween(4, 60),
          averageRating: Math.round((4 + rng()) * 10) / 10,
          skillIds: definition.skills
            .map((name) => skillByName.get(name)?.id)
            .filter((id): id is string => Boolean(id)),
        },
      });

      // Three to five modules, each with two or three lessons.
      const moduleCount = intBetween(3, 5);
      for (let m = 0; m < moduleCount; m += 1) {
        const module = await prisma.module.create({
          data: {
            courseId: course.id,
            title: pick([
              `Getting started with ${definition.skills[0]}`,
              `Core concepts`,
              `Working with real data`,
              `Advanced techniques`,
              `Putting it into practice`,
              `Capstone project`,
            ]),
            description: `Module ${m + 1} of ${moduleCount}.`,
            order: m,
            requiresQuiz: m === moduleCount - 1,
          },
        });

        const lessonCount = intBetween(2, 3);
        for (let l = 0; l < lessonCount; l += 1) {
          await prisma.lesson.create({
            data: {
              moduleId: module.id,
              title: `Lesson ${m + 1}.${l + 1}`,
              contentType: chance(0.6) ? 'VIDEO' : 'TEXT',
              videoUrl: chance(0.6) ? `https://videos.example.com/${course.slug}/${m + 1}-${l + 1}` : null,
              content:
                'In this lesson we work through the concept step by step, then apply it to a sample dataset. ' +
                'Try each step yourself before moving on — the exercise that follows assumes you have.',
              durationMinutes: intBetween(8, 25),
              order: l,
              isPreview: m === 0 && l === 0,
            },
          });
        }
      }

      return course;
    }),
  );

  console.log(`   ${courses.length} courses with modules and lessons`);

  /* ---------------------------------------------------------------------- */
  /* Project briefs and submissions                                          */
  /* ---------------------------------------------------------------------- */

  const projects = await Promise.all(
    PROJECTS.map((definition) =>
      prisma.project.create({
        data: {
          collegeId: xyz.id,
          title: definition.title,
          summary: definition.summary,
          brief:
            `${definition.summary}\n\n` +
            `Deliverables:\n` +
            `• A working artefact (dashboard, model, analysis or deployed site)\n` +
            `• A short written explanation of your approach and the trade-offs you made\n` +
            `• A summary of what you would do differently with more time\n\n` +
            `Submit a link to your work and a two-paragraph write-up. A mentor reviews it against a rubric and ` +
            `returns scored feedback within five working days.`,
          requirements: [
            'Working artefact accessible via a link',
            'Two-paragraph written explanation',
            'Source file or repository where applicable',
          ],
          techStack: definition.skills,
          skillIds: definition.skills
            .map((name) => skillByName.get(name)?.id)
            .filter((id): id is string => Boolean(id)),
          difficulty: definition.difficulty,
          estimatedHours: definition.difficulty * 6,
          isPremium: chance(0.3),
          isCaseStudy: chance(0.4),
        },
      }),
    ),
  );

  console.log(`   ${projects.length} project briefs`);

  /* ---------------------------------------------------------------------- */
  /* Jobs and internships                                                    */
  /* ---------------------------------------------------------------------- */

  const jobs = await Promise.all(
    JOBS.map(async (definition, index) => {
      const employer = employers[definition.company]!;

      const job = await prisma.job.create({
        data: {
          employerId: employer.profile.id,
          title: definition.title,
          slug: `${slugify(definition.title)}-${index + 1}`,
          description:
            `${definition.title} at ${employer.profile.companyName}.\n\n` +
            `You will work alongside the team on live problems, with a structured onboarding in your first month ` +
            `and a mentor assigned for your first quarter. We hire for aptitude and evidence of having built ` +
            `something — your CampusConnect portfolio and verified certificates count.\n\n` +
            `What we look for:\n` +
            `• Demonstrated skill in ${definition.skills.join(', ')}\n` +
            `• Comfort working with messy, real data or requirements\n` +
            `• Clear written communication — we work asynchronously across locations`,
          role: definition.title,
          employmentType: definition.type === 'INTERNSHIP' ? 'INTERNSHIP' : 'FULL_TIME',
          workMode: definition.mode as never,
          location: definition.location,
          salaryMin: definition.salaryMin,
          salaryMax: definition.salaryMax,
          currency: 'INR',
          isSalaryVisible: true,
          experienceMinYears: definition.type === 'INTERNSHIP' ? 0 : 0,
          educationRequirement: definition.education,
          eligibleGraduationYears:
            definition.type === 'INTERNSHIP'
              ? [new Date().getFullYear() + 1, new Date().getFullYear() + 2]
              : [new Date().getFullYear(), new Date().getFullYear() + 1],
          eligibleCollegeIds: [],
          skillIds: definition.skills
            .map((name) => skillByName.get(name)?.id)
            .filter((id): id is string => Boolean(id)),
          minReadinessScore: chance(0.4) ? pick([40, 50, 60]) : null,
          openings: intBetween(1, 5),
          applicationDeadline: daysFromNow(intBetween(7, 45), 23),
          joiningDate: daysFromNow(intBetween(60, 120), 10),
          status: 'PUBLISHED',
          publishedAt: daysFromNow(-intBetween(3, 40), 12),
          viewCount: intBetween(30, 900),
          applicantCount: 0,
        },
      });

      // Normalised skill links with weights, which is what the matcher reads.
      for (const [skillIndex, skillName] of definition.skills.entries()) {
        const skill = skillByName.get(skillName);
        if (!skill) continue;

        await prisma.jobSkill.create({
          data: {
            jobId: job.id,
            skillId: skill.id,
            // The first listed skill is the must-have; the rest are weighted down.
            required: skillIndex === 0,
            weight: skillIndex === 0 ? 3 : 1,
            minLevel: skillIndex === 0 ? 'INTERMEDIATE' : 'BEGINNER',
          },
        });
      }

      return job;
    }),
  );

  console.log(`   ${jobs.length} job and internship postings`);

  /* ---------------------------------------------------------------------- */
  /* Internships (curated + employer-posted)                                 */
  /* ---------------------------------------------------------------------- */

  const internships = await Promise.all(
    [
      { title: 'Data Analytics Internship — Northwind', employer: 0, curated: false, skills: ['Power BI', 'SQL'], months: 6, stipend: 20_000, kind: 'INTERNSHIP' },
      { title: 'Campus Business Analytics Project', employer: null, curated: true, skills: ['Advanced Excel', 'Data Cleaning'], months: 2, stipend: 8_000, kind: 'INDUSTRY_PROJECT' },
      { title: 'Marketing Internship — Vertex Retail', employer: 1, curated: false, skills: ['Digital Marketing', 'Social Media Marketing'], months: 3, stipend: 15_000, kind: 'INTERNSHIP' },
      { title: 'Finance Apprenticeship — Lumen', employer: 2, curated: false, skills: ['Financial Modelling', 'Accounting'], months: 12, stipend: 22_000, kind: 'APPRENTICESHIP' },
      { title: 'Design Systems Apprenticeship — Pixelcraft', employer: 3, curated: false, skills: ['Brand Management', 'Content Writing'], months: 6, stipend: 18_000, kind: 'APPRENTICESHIP' },
      { title: 'Frontend Engineering Internship — Cobalt', employer: 4, curated: false, skills: ['React', 'JavaScript'], months: 6, stipend: 25_000, kind: 'INTERNSHIP' },
      { title: 'Retail Operations Virtual Internship', employer: 1, curated: false, skills: ['Advanced Excel', 'Time Management'], months: 2, stipend: 10_000, kind: 'INTERNSHIP' },
    ].map(async (definition, index) => {
      const employer = definition.employer !== null ? employers[definition.employer]! : null;

      return prisma.internship.create({
        data: {
          employerId: employer?.profile.id ?? null,
          collegeId: definition.curated ? xyz.id : null,
          isCurated: definition.curated,
          title: definition.title,
          slug: `${slugify(definition.title)}-${index + 1}`,
          description:
            `${definition.title}.\n\n` +
            `A ${definition.months}-month ${definition.kind.toLowerCase().replace(/_/g, ' ')} with real ownership from ` +
            `week two. You will be paired with a mentor, set quarterly goals, and finish with a written reference ` +
            `if you complete the engagement.\n\n` +
            `Open to students who can demonstrate ${definition.skills.join(' and ')} — assessments and reviewed ` +
            `projects on your Career Passport count as evidence.`,
          companyName: employer?.profile.companyName ?? 'XYZ College Placement Cell',
          role: definition.title,
          workMode: definition.curated ? 'REMOTE' : pick(['REMOTE', 'ONSITE', 'HYBRID']),
          location: definition.curated ? 'Remote' : employer?.profile.headquarters,
          durationMonths: definition.months,
          stipendMonthly: definition.stipend * 100,
          currency: 'INR',
          skillIds: definition.skills
            .map((name) => skillByName.get(name)?.id)
            .filter((id): id is string => Boolean(id)),
          minReadinessScore: chance(0.4) ? 45 : null,
          eligibleGraduationYears: [new Date().getFullYear() + 1, new Date().getFullYear() + 2],
          openings: intBetween(2, 12),
          isPremium: chance(0.35),
          opportunityKind: definition.kind,
          applicationDeadline: daysFromNow(intBetween(10, 50), 23),
          startDate: daysFromNow(intBetween(60, 130), 10),
          isPublished: true,
          publishedAt: daysFromNow(-intBetween(5, 35), 12),
        },
      });
    }),
  );

  console.log(`   ${internships.length} internships (1 curated, 6 employer-posted)`);

  /* ---------------------------------------------------------------------- */
  /* Applications                                                            */
  /* ---------------------------------------------------------------------- */

  let applicationCount = 0;

  for (const job of jobs) {
    const collegeStudents = allStudents.filter(
      (student) => student.graduationYear !== null,
    );

    const applicants = pickMany(collegeStudents, intBetween(2, 14));

    for (const student of applicants) {
      // Eligibility is deliberately respected: a student outside the eligible
      // graduation years does not apply.
      const eligible = await prisma.job.findFirst({
        where: {
          id: job.id,
          OR: [{ eligibleGraduationYears: { isEmpty: true } }, { eligibleGraduationYears: { has: student.graduationYear } }],
        },
        select: { id: true },
      });
      if (!eligible) continue;

      const status = pick([
        'APPLIED', 'APPLIED', 'APPLIED',
        'UNDER_REVIEW', 'UNDER_REVIEW',
        'SHORTLISTED',
        'INTERVIEW_SCHEDULED',
        'INTERVIEWED',
        'OFFER',
        'HIRED',
        'REJECTED', 'REJECTED',
        'WITHDRAWN',
      ]);

      const appliedAt = daysFromNow(-intBetween(2, 45), intBetween(9, 20));
      const progressed = ['SHORTLISTED', 'INTERVIEW_SCHEDULED', 'INTERVIEWED', 'OFFER', 'HIRED'].includes(status);
      const offered = ['OFFER', 'HIRED'].includes(status);

      await prisma.application.create({
        data: {
          userId: student.id,
          collegeId: student.collegeId,
          jobId: job.id,
          status: status as never,
          matchScore: intBetween(45, 95),
          matchReasons: [],
          source: chance(0.7) ? 'DIRECT' : 'RECOMMENDED',
          consentToShare: true,
          appliedAt,
          reviewedAt: status !== 'APPLIED' ? new Date(appliedAt.getTime() + 86_400_000 * 2) : null,
          shortlistedAt: progressed ? new Date(appliedAt.getTime() + 86_400_000 * 5) : null,
          rejectedAt: status === 'REJECTED' ? new Date(appliedAt.getTime() + 86_400_000 * 8) : null,
          rejectReason: status === 'REJECTED' ? pick(['Stronger candidates with more relevant project experience.', 'Role closed.', 'Skills mismatch on the core requirement.']) : null,
          offeredAt: offered ? new Date(appliedAt.getTime() + 86_400_000 * 14) : null,
          hiredAt: status === 'HIRED' ? new Date(appliedAt.getTime() + 86_400_000 * 18) : null,
          withdrawnAt: status === 'WITHDRAWN' ? new Date(appliedAt.getTime() + 86_400_000 * 4) : null,
        },
      });

      applicationCount += 1;
    }

    const applicantCount = await prisma.application.count({ where: { jobId: job.id } });
    await prisma.job.update({ where: { id: job.id }, data: { applicantCount } });
  }

  console.log(`   ${applicationCount} applications`);

  /* ---------------------------------------------------------------------- */
  /* Resume, skills, assessments, interviews for the example persona         */
  /* ---------------------------------------------------------------------- */

  // Skills on Rahul's profile, sized to make the readiness pillars land in the
  // "nearly ready" band rather than at the top or bottom.
  const rahulSkillPlan: { name: string; proficiency: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED' | 'EXPERT'; score: number; verified: boolean }[] = [
    { name: 'Advanced Excel', proficiency: 'EXPERT', score: 92, verified: true },
    { name: 'Power BI', proficiency: 'ADVANCED', score: 84, verified: true },
    { name: 'SQL', proficiency: 'ADVANCED', score: 78, verified: true },
    { name: 'Data Visualization', proficiency: 'ADVANCED', score: 80, verified: false },
    { name: 'Statistics', proficiency: 'INTERMEDIATE', score: 62, verified: true },
    { name: 'Data Cleaning', proficiency: 'INTERMEDIATE', score: 70, verified: false },
    { name: 'Public Speaking', proficiency: 'INTERMEDIATE', score: 58, verified: false },
    { name: 'Business Writing', proficiency: 'INTERMEDIATE', score: 64, verified: false },
    { name: 'Problem Solving', proficiency: 'INTERMEDIATE', score: 68, verified: false },
    { name: 'Python', proficiency: 'BEGINNER', score: 34, verified: false },
  ];

  for (const plan of rahulSkillPlan) {
    const skill = skillByName.get(plan.name);
    if (!skill) continue;

    await prisma.studentSkill.create({
      data: {
        studentProfileId: rahulProfile.id,
        skillId: skill.id,
        proficiency: plan.proficiency,
        score: plan.score,
        source: plan.verified ? 'ASSESSMENT' : 'SELF',
        isVerified: plan.verified,
        verifiedById: plan.verified ? courseTrainer.id : null,
        verifiedAt: plan.verified ? daysFromNow(-intBetween(20, 90), 12) : null,
        yearsExperience: Math.round((0.5 + rng() * 2.5) * 10) / 10,
      },
    });
  }

  // A lighter skill set for the general student population, so analytics have
  // something to aggregate and the skill-gap report is not empty.
  for (const student of allStudents.slice(1)) {
    if (!chance(0.75)) continue;

    const chosen = pickMany(allSkills, intBetween(2, 7));

    for (const skill of chosen) {
      const score = intBetween(20, 92);
      const proficiency = score >= 85 ? 'EXPERT' : score >= 65 ? 'ADVANCED' : score >= 40 ? 'INTERMEDIATE' : 'BEGINNER';

      await prisma.studentSkill.create({
        data: {
          studentProfileId: student.profileId,
          skillId: skill.id,
          proficiency: proficiency as never,
          score,
          source: chance(0.4) ? 'ASSESSMENT' : 'SELF',
          isVerified: chance(0.35),
          verifiedById: chance(0.35) ? courseTrainer.id : null,
          verifiedAt: chance(0.35) ? daysFromNow(-intBetween(10, 150), 12) : null,
        },
      });
    }
  }

  // Project submission for Rahul, with a mentor review — this is what gives his
  // passport an approved portfolio entry and feeds the projects pillar.
  const rahulSubmission = await prisma.projectSubmission.create({
    data: {
      projectId: projects[0]!.id,
      userId: rahul.id,
      collegeId: xyz.id,
      status: 'APPROVED',
      repoUrl: 'https://github.com/rahul-sharma-example/retail-sales-dashboard',
      liveUrl: null,
      summary:
        'Built a four-page Power BI dashboard over three years of retail transactions. The reconciliation page surfaced a 3.1% mismatch between the POS and inventory systems that had gone unnoticed for two quarters.',
      submissionNote: 'Used a star schema with a separate date dimension to keep the time-intelligence measures fast.',
      isApproved: true,
      approvedAt: daysFromNow(-intBetween(20, 60), 12),
      score: 86,
      submittedAt: daysFromNow(-intBetween(60, 90), 12),
    },
  });

  await prisma.review.create({
    data: {
      submissionId: rahulSubmission.id,
      reviewerId: courseTrainer.id,
      rubric: [
        { criterion: 'Problem understanding', maxPoints: 25, score: 23, comment: 'Clear framing of the business question.' },
        { criterion: 'Technical execution', maxPoints: 35, score: 30, comment: 'Star schema is the right call; measures are well scoped.' },
        { criterion: 'Insight quality', maxPoints: 25, score: 21, comment: 'The reconciliation finding is genuinely useful — lead with it.' },
        { criterion: 'Communication', maxPoints: 15, score: 12, comment: 'Write-up is concise. A short executive summary page would help.' },
      ],
      totalScore: 86,
      maxScore: 100,
      feedback:
        'Strong work. The data model decisions are sound and the reconciliation finding shows you went looking for a problem rather than describing a chart. ' +
        'For a second iteration: add a short executive summary at the top for a non-technical reader, and document your DAX measures so a colleague could maintain the report.',
      strengths: ['Sound star-schema modelling', 'Found a real data-quality issue', 'Clear written explanation'],
      improvements: ['Add an executive summary page', 'Document the DAX measures'],
      decision: 'APPROVED',
      createdAt: new Date(rahulSubmission.approvedAt!.getTime() + 86_400_000),
    },
  });

  const secondSubmission = await prisma.projectSubmission.create({
    data: {
      projectId: projects[4]!.id,
      userId: rahul.id,
      collegeId: xyz.id,
      status: 'UNDER_REVIEW',
      repoUrl: null,
      summary:
        'Analysed two semesters of campus event registration and attendance data across 14 events, and proposed a calendar that avoids the exam-period clash that consistently depressed attendance in March.',
      submissionNote: 'Submitted for review — happy to add the sensitivity analysis if that would strengthen it.',
      isApproved: false,
      submittedAt: daysFromNow(-4, 20),
    },
  });

  // A third approved project so the projects pillar has breadth.
  await prisma.projectSubmission.create({
    data: {
      projectId: projects[2]!.id,
      userId: rahul.id,
      collegeId: xyz.id,
      status: 'APPROVED',
      summary:
        'Diagnosed a 62% drop-off between the landing page and the signup step for a student club campaign, and proposed a reallocation that would have recovered roughly a third of the lost conversions.',
      isApproved: true,
      approvedAt: daysFromNow(-intBetween(90, 130), 12),
      score: 79,
      submittedAt: daysFromNow(-intBetween(130, 160), 12),
    },
  });

  // Resume, generated from the passport-shaped data.
  await prisma.resume.create({
    data: {
      userId: rahul.id,
      title: 'Data Analyst — Campus Placements',
      templateId: 'modern',
      content: {
        summary:
          'Final-year BBA student focused on business analytics. Advanced Excel and Power BI with a mentor-reviewed retail dashboard project. Seeking a data analyst role.',
        education: [
          {
            institution: 'XYZ College of Business and Technology',
            degree: 'BBA',
            year: String(new Date().getFullYear() + 1),
            detail: 'CGPA 8.4/10',
          },
        ],
        skills: rahulSkillPlan.filter((s) => s.score >= 60).map((s) => `${s.name} (${s.proficiency.toLowerCase()})`),
        experience: [],
        projects: [
          {
            title: 'Retail Sales Dashboard',
            description: 'Four-page Power BI dashboard over three years of transactions; found a 3.1% POS-inventory mismatch.',
          },
        ],
      },
      score: 78,
      suggestions: [
        'Add numbers to more bullets — only 1 of 3 currently has a measurable result.',
        'Add an internship entry: even a short industry project strengthens this section.',
        'Your GitHub link is present but the summary does not mention your technical stack.',
      ],
      scoredAt: daysFromNow(-6, 12),
      isPrimary: true,
      version: 3,
    },
  });

  // Skills assessment definitions and Rahul's attempts.
  const excelAssessment = await prisma.assessment.create({
    data: {
      collegeId: xyz.id,
      name: 'Advanced Excel Assessment',
      slug: 'advanced-excel',
      description: 'Twelve timed questions covering lookups, pivot tables, Power Query and array formulas.',
      kind: 'SKILL',
      categoryId: skillRows[0]!.category.id,
      skillId: skillByName.get('Advanced Excel')?.id ?? null,
      durationMinutes: 20,
      passScore: 60,
      isActive: true,
    },
  });

  const sqlAssessment = await prisma.assessment.create({
    data: {
      collegeId: xyz.id,
      name: 'SQL Fundamentals Assessment',
      slug: 'sql-fundamentals',
      description: 'Ten questions on joins, aggregation, subqueries and query performance.',
      kind: 'SKILL',
      categoryId: skillRows[0]!.category.id,
      skillId: skillByName.get('SQL')?.id ?? null,
      durationMinutes: 20,
      passScore: 60,
      isActive: true,
    },
  });

  await prisma.assessment.create({
    data: {
      collegeId: xyz.id,
      name: 'Career Interests Questionnaire',
      slug: 'career-interests',
      description: 'Twenty questions matching your interests to a career track. No right answers.',
      kind: 'INTEREST',
      durationMinutes: 10,
      passScore: 0,
      isActive: true,
    },
  });

  const assessmentQuestions = [
    { assessmentId: excelAssessment.id, prompt: 'Which function returns the position of a value in a range?', options: [{ id: 'a', text: 'VLOOKUP' }, { id: 'b', text: 'MATCH' }, { id: 'c', text: 'INDEX' }, { id: 'd', text: 'OFFSET' }], correct: 'b', explanation: 'MATCH returns a relative position within a range, which is why it pairs with INDEX.' },
    { assessmentId: excelAssessment.id, prompt: 'What does Power Query primarily do?', options: [{ id: 'a', text: 'Chart rendering' }, { id: 'b', text: 'Data extraction and transformation' }, { id: 'c', text: 'Formula auditing' }, { id: 'd', text: 'Print layout' }], correct: 'b', explanation: 'Power Query handles extract-transform-load steps recorded as repeatable M code.' },
    { assessmentId: excelAssessment.id, prompt: 'A pivot table shows an average of 0 for a text column. Why?', options: [{ id: 'a', text: 'The column contains numbers stored as text' }, { id: 'b', text: 'The pivot cache is stale' }, { id: 'c', text: 'Averages cannot be calculated' }, { id: 'd', text: 'The field is in the filter area' }], correct: 'a', explanation: 'Numbers stored as text are ignored by aggregation, which yields 0.' },
    { assessmentId: excelAssessment.id, prompt: 'Which lookup approach is most robust to inserted columns?', options: [{ id: 'a', text: 'VLOOKUP with a hard-coded column index' }, { id: 'b', text: 'HLOOKUP' }, { id: 'c', text: 'INDEX with MATCH' }, { id: 'd', text: 'Direct cell references' }], correct: 'c', explanation: 'INDEX/MATCH resolves by header position at runtime, so an inserted column does not break it.' },
    { assessmentId: sqlAssessment.id, prompt: 'Which join keeps unmatched rows from the left table?', options: [{ id: 'a', text: 'INNER JOIN' }, { id: 'b', text: 'LEFT JOIN' }, { id: 'c', text: 'CROSS JOIN' }, { id: 'd', text: 'SELF JOIN' }], correct: 'b', explanation: 'A LEFT JOIN preserves every left-hand row, filling NULLs where there is no match.' },
    { assessmentId: sqlAssessment.id, prompt: 'What does GROUP BY do before aggregation?', options: [{ id: 'a', text: 'Sorts the result' }, { id: 'b', text: 'Collapses rows sharing the grouped values into one row' }, { id: 'c', text: 'Filters rows' }, { id: 'd', text: 'Removes duplicates permanently' }], correct: 'b', explanation: 'GROUP BY reduces each distinct combination of grouped values to a single row for aggregation.' },
    { assessmentId: sqlAssessment.id, prompt: 'Where does a HAVING clause apply?', options: [{ id: 'a', text: 'Before grouping' }, { id: 'b', text: 'After grouping, to aggregated results' }, { id: 'c', text: 'To the join condition only' }, { id: 'd', text: 'In the ORDER BY' }], correct: 'b', explanation: 'HAVING filters after aggregation, which is why it can reference aggregate functions and WHERE cannot.' },
  ];

  for (const [index, question] of assessmentQuestions.entries()) {
    await prisma.assessmentQuestion.create({
      data: {
        assessmentId: question.assessmentId,
        prompt: question.prompt,
        options: question.options,
        correctOptionId: question.correct,
        explanation: question.explanation,
        difficulty: index < 3 ? 2 : 3,
        points: 1,
        sortOrder: index,
      },
    });
  }

  await prisma.assessmentAttempt.create({
    data: {
      assessmentId: excelAssessment.id,
      userId: rahul.id,
      collegeId: xyz.id,
      startedAt: daysFromNow(-45, 10),
      submittedAt: daysFromNow(-45, 10),
      answers: { q1: 'b', q2: 'b', q3: 'a', q4: 'c' },
      score: 92,
      breakdown: { 'Advanced Excel': 92 },
      passed: true,
      appliedToProfile: true,
    },
  });

  await prisma.assessmentAttempt.create({
    data: {
      assessmentId: sqlAssessment.id,
      userId: rahul.id,
      collegeId: xyz.id,
      startedAt: daysFromNow(-30, 15),
      submittedAt: daysFromNow(-30, 15),
      answers: { q1: 'b', q2: 'b', q3: 'b' },
      score: 78,
      breakdown: { SQL: 78 },
      passed: true,
      appliedToProfile: true,
    },
  });

  // Readiness roadmap, so the dashboard stepper has an active plan.
  const roadmap = await prisma.roadmap.create({
    data: {
      userId: rahul.id,
      track: 'Data Analyst',
      title: 'Your path to Data Analyst',
      summary: 'Closes your two largest gaps — Python and Statistics — and adds the interview practice you are missing.',
      generatedBy: 'rule-based',
      gapSnapshot: {
        targetRole: 'Data Analyst',
        matchPercentage: 68,
        gaps: [
          { skill: 'Python', gap: 41, importance: 0.8 },
          { skill: 'Statistics', gap: 13, importance: 0.6 },
        ],
      },
      isActive: true,
    },
  });

  const roadmapSteps = [
    { title: 'Complete "SQL for Analysts"', actionType: 'COMPLETE_COURSE', gap: 'SQL', hours: 6, order: 0 },
    { title: 'Finish the Customer Churn Analysis project', actionType: 'BUILD_PROJECT', gap: 'Statistics', hours: 24, order: 1 },
    { title: 'Take the Career Interests Questionnaire', actionType: 'TAKE_ASSESSMENT', gap: 'Direction', hours: 1, order: 2 },
    { title: 'Book a mock interview for a Data Analyst role', actionType: 'BOOK_MOCK', gap: 'Interview', hours: 2, order: 3 },
    { title: 'Apply to 5 matched Data Analyst openings', actionType: 'APPLY', gap: 'Placement', hours: 3, order: 4 },
  ];

  for (const step of roadmapSteps) {
    const created = await prisma.roadmapStep.create({
      data: {
        roadmapId: roadmap.id,
        title: step.title,
        description: `Focused on ${step.gap}. Estimated ${step.hours} hours.`,
        actionType: step.actionType,
        order: step.order,
        estimatedHours: step.hours,
      },
    });

    await prisma.roadmapStepProgress.create({
      data: {
        roadmapStepId: created.id,
        userId: rahul.id,
        // The first two are done, the third is in progress — a believable state.
        status: step.order === 0 ? 'COMPLETED' : step.order === 1 ? 'COMPLETED' : step.order === 2 ? 'IN_PROGRESS' : 'NOT_STARTED',
        progressPct: step.order === 0 ? 100 : step.order === 1 ? 100 : step.order === 2 ? 40 : 0,
        completedAt: step.order < 2 ? daysFromNow(-intBetween(5, 25), 12) : null,
      },
    });
  }

  // Mock interview with feedback, which is what feeds the interview pillar.
  const mockInterview = await prisma.mockInterview.create({
    data: {
      candidateId: rahul.id,
      mentorId: courseTrainer.id,
      collegeId: xyz.id,
      targetRole: 'Data Analyst',
      mode: 'MENTOR',
      status: 'COMPLETED',
      scheduledAt: daysFromNow(-18, 16),
      durationMinutes: 45,
      questionIds: ['analytics-sql-join', 'analytics-dashboard-stakeholder', 'common-tell-me-about-yourself'],
      answers: [
        { questionId: 'common-tell-me-about-yourself', text: 'Covered current focus, the retail dashboard project and the target role.', durationSeconds: 95 },
        { questionId: 'analytics-sql-join', text: 'Explained the difference and gave a scenario using a sales and returns table.', durationSeconds: 130 },
        { questionId: 'analytics-dashboard-stakeholder', text: 'Described asking what decision the dashboard drives before building anything.', durationSeconds: 145 },
      ],
      isPremium: false,
    },
  });

  await prisma.mockInterviewFeedback.create({
    data: {
      mockInterviewId: mockInterview.id,
      mentorId: courseTrainer.id,
      communicationScore: 76,
      confidenceScore: 68,
      contentScore: 84,
      overallScore: 76,
      strengths: [
        'Strong, specific examples — the retail reconciliation story landed well.',
        'Good instinct for pushing back on a vague dashboard request.',
      ],
      improvements: [
        'Slow down. You spoke at roughly 190 words per minute in the first answer.',
        'State the result explicitly at the end of every behavioural answer.',
        'Hedged seven times ("I think maybe"). Practise stating your reasoning directly.',
      ],
      comments:
        'Content is genuinely strong — you know your material. The gap is delivery: pace and hedging cost you more than the technical answers did. ' +
        'Record yourself twice more on the "tell me about yourself" answer and it will be interview-ready.',
    },
  });

  // Two more mock interviews for the general population, so the mentor queue and
  // analytics are not empty.
  for (const student of pickMany(allStudents.slice(1), 12)) {
    const status = pick(['COMPLETED', 'SCHEDULED', 'REQUESTED', 'COMPLETED', 'COMPLETED']);

    const created = await prisma.mockInterview.create({
      data: {
        candidateId: student.id,
        mentorId: chance(0.7) ? courseTrainer.id : facultyCoordinator.id,
        collegeId: student.collegeId,
        targetRole: pick(['Data Analyst', 'Business Analyst', 'Digital Marketing Executive', 'Finance Analyst', 'Software Engineer']),
        mode: chance(0.75) ? 'MENTOR' : 'SELF_PRACTICE',
        status: status as never,
        scheduledAt: status === 'REQUESTED' ? null : daysFromNow(intBetween(-40, 14), intBetween(10, 18)),
        durationMinutes: 30,
        questionIds: [],
        isPremium: chance(0.2),
      },
    });

    if (status === 'COMPLETED') {
      const communicationScore = intBetween(45, 92);
      const confidenceScore = intBetween(40, 90);
      const contentScore = intBetween(50, 95);

      await prisma.mockInterviewFeedback.create({
        data: {
          mockInterviewId: created.id,
          mentorId: courseTrainer.id,
          communicationScore,
          confidenceScore,
          contentScore,
          overallScore: Math.round((communicationScore + confidenceScore + contentScore) / 3),
          strengths: ['Answered the question directly', 'Gave a concrete example'],
          improvements: ['Structure the answer with STAR', 'Close with a quantified result'],
          comments: 'Solid foundation. Work on structure before adding more detail.',
        },
      });
    }
  }

  console.log('   Skills, projects, resume, roadmap, assessments and mock interviews');

  /* ---------------------------------------------------------------------- */
  /* Readiness recalculation                                                 */
  /* ---------------------------------------------------------------------- */

  /**
   * Readiness is computed from the evidence just written rather than hard-coded,
   * so the score on every passport reconciles with the rows behind it. This mirrors
   * `passportService.recalculateReadiness` — duplicated here because the seed runs
   * without importing the API's module graph.
   */
  const READINESS_WEIGHTS = { skills: 0.3, projects: 0.25, internship: 0.25, interview: 0.2 };

  async function computeReadiness(studentId: string, profileId: string): Promise<{
    score: number;
    skills: number;
    projects: number;
    internship: number;
    interview: number;
  }> {
    const [skills, submissions, internshipApps, interviews] = await Promise.all([
      prisma.studentSkill.findMany({
        where: { studentProfileId: profileId, deletedAt: null },
        select: { score: true, isVerified: true },
      }),
      prisma.projectSubmission.findMany({
        where: { userId: studentId, isApproved: true, deletedAt: null },
        select: {
          score: true,
          project: { select: { difficulty: true } },
          reviews: { orderBy: { createdAt: 'desc' }, take: 1, select: { totalScore: true } },
        },
      }),
      prisma.application.findMany({
        where: { userId: studentId, internshipId: { not: null }, status: 'HIRED' },
        select: { internship: { select: { durationMonths: true } } },
      }),
      prisma.mockInterview.findMany({
        where: { candidateId: studentId, status: 'COMPLETED' },
        select: { feedback: { take: 1, select: { overallScore: true } } },
      }),
    ]);

    // Skills: top-8 average, verified counting in full and self-declared at 70%.
    let skillsPillar = 0;
    if (skills.length > 0) {
      const weighted = skills
        .map((skill) => skill.score * (skill.isVerified ? 1 : 0.7))
        .sort((a, b) => b - a)
        .slice(0, 8);
      const depth = weighted.reduce((sum, value) => sum + value, 0) / weighted.length;
      const breadth = Math.min(1, skills.length / 6 / (1 + Math.max(0, skills.length / 6 - 1)));
      skillsPillar = depth * (0.85 + 0.15 * breadth);
    }

    // Projects: best-four average, scaled by rubric score and difficulty.
    let projectsPillar = 0;
    if (submissions.length > 0) {
      const contributions = submissions
        .map((submission) => {
          const quality = (submission.reviews[0]?.totalScore ?? submission.score ?? 70) / 100;
          const difficultyMultiplier = 0.8 + (Math.min(5, Math.max(1, submission.project.difficulty)) - 1) * 0.1;
          return quality * difficultyMultiplier * 100;
        })
        .sort((a, b) => b - a)
        .slice(0, 4);

      const average = contributions.reduce((sum, value) => sum + value, 0) / contributions.length;
      const breadth = Math.min(1, submissions.length / 4 / (1 + Math.max(0, submissions.length / 4 - 1)));
      projectsPillar = average * (0.9 + 0.1 * breadth);
    }

    // Internships.
    let internshipPillar = 0;
    if (internshipApps.length > 0) {
      const base = internshipApps.length === 1 ? 70 : internshipApps.length === 2 ? 85 : 95;
      const longest = Math.max(...internshipApps.map((app) => app.internship?.durationMonths ?? 2));
      internshipPillar = Math.min(100, base + (longest >= 6 ? 5 : longest >= 3 ? 2 : 0));
    }

    // Interviews: 70% recent average, 30% best.
    let interviewPillar = 0;
    const scores = interviews.map((interview) => interview.feedback[0]?.overallScore ?? 0).filter((s) => s > 0);
    if (scores.length > 0) {
      const recent = scores.slice(0, 3);
      const average = recent.reduce((sum, value) => sum + value, 0) / recent.length;
      interviewPillar = average * 0.7 + Math.max(...scores) * 0.3;
    }

    const weighted =
      skillsPillar * READINESS_WEIGHTS.skills +
      projectsPillar * READINESS_WEIGHTS.projects +
      internshipPillar * READINESS_WEIGHTS.internship +
      interviewPillar * READINESS_WEIGHTS.interview;

    return {
      score: Math.max(0, Math.min(100, Math.round(weighted))),
      skills: Math.round(skillsPillar),
      projects: Math.round(projectsPillar),
      internship: Math.round(internshipPillar),
      interview: Math.round(interviewPillar),
    };
  }

  for (const student of allStudents) {
    const readiness = await computeReadiness(student.id, student.profileId);

    // Rolled-up counters, taken from the same rows the passport reads.
    const [eventsAttended, certificates, projectsDone, internshipsDone] = await Promise.all([
      prisma.attendance.count({ where: { studentId: student.id, revokedAt: null } }),
      prisma.certificate.count({ where: { studentId: student.id, status: 'ISSUED', deletedAt: null } }),
      prisma.projectSubmission.count({ where: { userId: student.id, isApproved: true, deletedAt: null } }),
      prisma.application.count({ where: { userId: student.id, internshipId: { not: null }, status: 'HIRED' } }),
    ]);

    await prisma.studentProfile.update({
      where: { id: student.profileId },
      data: {
        readinessScore: readiness.score,
        readinessSkills: readiness.skills,
        readinessProjects: readiness.projects,
        readinessInternship: readiness.internship,
        readinessInterview: readiness.interview,
        readinessUpdatedAt: new Date(),
        eventsAttended,
        certificatesEarned: certificates,
        projectsCompleted: projectsDone,
        internshipsCompleted: internshipsDone,
      },
    });

    // A 90-day readiness trend, so the student dashboard chart has a history. The
    // walk is a smooth ramp toward the final score rather than noise.
    const points = intBetween(4, 9);
    for (let i = points; i >= 0; i -= 1) {
      const capturedOn = new Date();
      capturedOn.setDate(capturedOn.getDate() - i * 10);
      capturedOn.setUTCHours(0, 0, 0, 0);

      if (capturedOn > new Date()) continue;

      const progress = (points - i) / points;
      const scoreAtPoint = Math.max(0, Math.round(readiness.score * (0.55 + 0.45 * progress)));

      await prisma.readinessSnapshot.upsert({
        where: { studentProfileId_capturedOn: { studentProfileId: student.profileId, capturedOn } },
        create: {
          studentProfileId: student.profileId,
          capturedOn,
          score: scoreAtPoint,
          skills: Math.round(readiness.skills * (0.6 + 0.4 * progress)),
          projects: Math.round(readiness.projects * (0.4 + 0.6 * progress)),
          internship: Math.round(readiness.internship * (0.3 + 0.7 * progress)),
          interview: Math.round(readiness.interview * (0.3 + 0.7 * progress)),
        },
        update: { score: scoreAtPoint },
      });
    }
  }

  console.log(`   Readiness recomputed for ${allStudents.length} students`);

  /* ---------------------------------------------------------------------- */
  /* Notifications                                                           */
  /* ---------------------------------------------------------------------- */

  const upcomingEvents = seededEvents.filter((event) => !event.isPast).slice(0, 4);

  for (const event of upcomingEvents) {
    const registrations = await prisma.eventRegistration.findMany({
      where: { eventId: event.id, status: { in: ['CONFIRMED', 'WAITLISTED'] } },
      select: { studentId: true, status: true, id: true },
      take: 40,
    });

    for (const registration of registrations) {
      await prisma.notification.create({
        data: {
          userId: registration.studentId,
          type: registration.status === 'WAITLISTED' ? 'EVENT_REGISTRATION' : 'EVENT_REMINDER',
          title:
            registration.status === 'WAITLISTED'
              ? `You're on the waitlist for ${event.title}`
              : `${event.title} is coming up`,
          body:
            registration.status === 'WAITLISTED'
              ? 'We will email you if a seat opens up.'
              : `Starts ${event.startAt.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}. Your QR pass is ready.`,
          actionUrl: registration.status === 'WAITLISTED' ? `/events/${event.id}` : `/dashboard/events/pass/${registration.id}`,
          status: chance(0.7) ? 'SENT' : 'QUEUED',
          readAt: chance(0.45) ? daysFromNow(-intBetween(1, 5), 12) : null,
          dedupeKey: `seed-reminder-${registration.id}`,
        },
      });
    }
  }

  // A certificate notification for each of Rahul's certificates.
  const rahulCertificates = await prisma.certificate.findMany({
    where: { studentId: rahul.id, status: 'ISSUED' },
    select: { certificateId: true, title: true, issuedAt: true },
    take: 6,
  });

  for (const certificate of rahulCertificates) {
    await prisma.notification.create({
      data: {
        userId: rahul.id,
        type: 'CERTIFICATE_ISSUED',
        title: 'Your certificate is ready',
        body: `${certificate.title} has been issued. Certificate ID ${certificate.certificateId}.`,
        actionUrl: `/verify/${certificate.certificateId}`,
        status: 'READ',
        readAt: new Date(certificate.issuedAt.getTime() + 3_600_000),
        emailedAt: certificate.issuedAt,
        dedupeKey: `seed-cert-${certificate.certificateId}`,
      },
    });
  }

  // Notification preferences and settings for every user.
  const allUsers = await prisma.user.findMany({ select: { id: true, role: true } });

  const defaultChannels: Record<string, string[]> = {
    EVENT_REGISTRATION: ['IN_APP', 'EMAIL'],
    EVENT_REMINDER: ['IN_APP', 'EMAIL'],
    EVENT_UPDATED: ['IN_APP', 'EMAIL'],
    CERTIFICATE_ISSUED: ['IN_APP', 'EMAIL'],
    DEADLINE_ALERT: ['IN_APP', 'EMAIL'],
    APPLICATION_STATUS: ['IN_APP', 'EMAIL'],
    INTERVIEW_SCHEDULE: ['IN_APP', 'EMAIL'],
    JOB_MATCH: ['IN_APP'],
    CLUB_MEMBERSHIP: ['IN_APP'],
    SYSTEM: ['IN_APP'],
  };

  for (const user of allUsers) {
    await prisma.notificationSetting.create({
      data: {
        userId: user.id,
        emailEnabled: user.role !== 'EMPLOYER' || chance(0.8),
        pushEnabled: chance(0.15),
        digestFrequency: chance(0.7) ? 'INSTANT' : chance(0.6) ? 'DAILY' : 'WEEKLY',
        quietHoursStart: chance(0.4) ? 22 : null,
        quietHoursEnd: chance(0.4) ? 7 : null,
      },
    });

    for (const [type, channels] of Object.entries(defaultChannels)) {
      await prisma.notificationPreference.create({
        data: { userId: user.id, type: type as never, channels: channels as never },
      });
    }
  }

  console.log(`   Notifications and preferences for ${allUsers.length} users`);

  /* ---------------------------------------------------------------------- */
  /* Subscriptions                                                           */
  /* ---------------------------------------------------------------------- */

  await prisma.subscription.createMany({
    data: [
      {
        collegeId: xyz.id,
        plan: 'COLLEGE_PRO',
        status: 'ACTIVE',
        currentPeriodStart: daysFromNow(-60, 0),
        currentPeriodEnd: daysFromNow(305, 0),
        seats: 2000,
      },
      {
        collegeId: sunrise.id,
        plan: 'COLLEGE_STARTER',
        status: 'TRIALING',
        currentPeriodStart: daysFromNow(-10, 0),
        currentPeriodEnd: daysFromNow(20, 0),
        trialEndsAt: daysFromNow(20, 0),
        seats: 500,
      },
      ...employers.slice(0, 3).map((employer) => ({
        employerId: employer.profile.id,
        plan: 'ENTERPRISE' as never,
        status: 'ACTIVE' as never,
        currentPeriodStart: daysFromNow(-90, 0),
        currentPeriodEnd: daysFromNow(275, 0),
        seats: 10,
      })),
    ],
  });

  console.log('   5 subscriptions');

  /* ---------------------------------------------------------------------- */
  /* Audit log                                                               */
  /* ---------------------------------------------------------------------- */

  await prisma.auditLog.createMany({
    data: [
      {
        userId: superAdmin.id,
        action: 'CREATE',
        entity: 'College',
        entityId: xyz.id,
        metadata: { name: 'XYZ College of Business and Technology', seeded: true },
        createdAt: daysFromNow(-200, 10),
      },
      {
        userId: collegeAdmin.id,
        collegeId: xyz.id,
        action: 'APPROVE',
        entity: 'Event',
        metadata: { seeded: true, count: 13 },
        createdAt: daysFromNow(-30, 14),
      },
      {
        userId: facultyCoordinator.id,
        collegeId: xyz.id,
        action: 'ISSUE',
        entity: 'Certificate',
        metadata: { seeded: true, count: certificateCount },
        createdAt: daysFromNow(-14, 11),
      },
      {
        userId: collegeAdmin.id,
        collegeId: xyz.id,
        action: 'EXPORT',
        entity: 'AnalyticsReport',
        metadata: { report: 'STUDENT_ENGAGEMENT', seeded: true },
        createdAt: daysFromNow(-7, 16),
      },
    ],
  });

  /* ---------------------------------------------------------------------- */
  /* College counters                                                        */
  /* ---------------------------------------------------------------------- */

  for (const college of [xyz, sunrise]) {
    const [studentCount, eventsHosted] = await Promise.all([
      prisma.user.count({ where: { collegeId: college.id, role: 'STUDENT', deletedAt: null } }),
      prisma.event.count({ where: { collegeId: college.id, status: 'COMPLETED', deletedAt: null } }),
    ]);

    await prisma.college.update({
      where: { id: college.id },
      data: { studentCount, eventsHosted },
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Summary                                                                 */
  /* ---------------------------------------------------------------------- */

  const [finalStudents, finalEvents, finalCourses, finalJobs, finalCertificates] = await Promise.all([
    prisma.user.count({ where: { role: 'STUDENT' } }),
    prisma.event.count(),
    prisma.course.count(),
    prisma.job.count(),
    prisma.certificate.count(),
  ]);

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  const rahulFinal = await prisma.studentProfile.findUnique({
    where: { userId: rahul.id },
    select: { readinessScore: true, eventsAttended: true, certificatesEarned: true, projectsCompleted: true },
  });

  console.log(`
✅ Seed complete in ${elapsed}s

   Colleges           2
   Departments        ${xyzDepartments.length + sunriseDepartments.length}
   Users              ${finalStudents} students + staff and employers
   Events             ${finalEvents}
   Registrations      ${registrationCount}
   Attendance         ${attendanceCount}
   Certificates       ${finalCertificates}
   Courses            ${finalCourses}
   Jobs               ${finalJobs}
   Internships        ${internships.length}
   Applications       ${applicationCount}
   Clubs              ${clubs.length}
   Skills             ${allSkills.length}

   Example persona — Rahul Sharma (rahul-sharma)
     Readiness score  ${rahulFinal?.readinessScore ?? 0}/100
     Events attended  ${rahulFinal?.eventsAttended ?? 0}
     Certificates     ${rahulFinal?.certificatesEarned ?? 0}
     Projects         ${rahulFinal?.projectsCompleted ?? 0}

🔑 Sign in at http://localhost:3000/login

   Student (example persona)
     rahul.sharma@xyzcollege.example.edu.in   ${DEFAULT_PASSWORD}
     Passport: http://localhost:3000/passport/rahul-sharma

   College admin / placement officer
     placement.officer@xyzcollege.example.edu.in   ${DEFAULT_PASSWORD}

   Faculty coordinator
     faculty@xyzcollege.example.edu.in   ${DEFAULT_PASSWORD}

   Trainer / mentor
     trainer@campusconnect.example   ${DEFAULT_PASSWORD}

   Employer (verified)
     hiring@northwind-analytics.example   ${DEFAULT_PASSWORD}

   Platform super admin
     admin@campusconnect.example   ${DEFAULT_PASSWORD}

   All ${allStudents.length} seeded students use the same password: ${DEFAULT_PASSWORD}

ℹ️  Placeholder content: company names, testimonials, logos and the landing-page
   statistics are illustrative examples, not real organisations or measurements.

Next: npm run dev
`);
}

/* -------------------------------------------------------------------------- */
/* Truncation                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Clears demo data before seeding.
 *
 * Order matters: children before parents. `TRUNCATE ... CASCADE` would be one
 * statement, but it also resets sequences and silently cascades into tables the
 * seed does not own — which makes a partial re-seed confusing. Explicit deletes
 * keep the blast radius visible.
 */
async function truncate(): Promise<void> {
  console.log('   Clearing existing data…');

  const tables = [
    'auditLog',
    'payment',
    'subscription',
    'passportView',
    'readinessSnapshot',
    'mockInterviewFeedback',
    'mockInterview',
    'review',
    'projectSubmission',
    'project',
    'roadmapStepProgress',
    'roadmapStep',
    'roadmap',
    'assessmentAttempt',
    'assessmentQuestion',
    'assessment',
    'enrollment',
    'lesson',
    'module',
    'course',
    'resume',
    'interviewSlot',
    'application',
    'jobSkill',
    'job',
    'internship',
    'studentSkill',
    'skill',
    'skillCategory',
    'feedback',
    'certificate',
    'certificateTemplate',
    'attendance',
    'eventRegistration',
    'eventApproval',
    'event',
    'clubMembership',
    'club',
    'notificationPreference',
    'notificationSetting',
    'notification',
    'fileAsset',
    'verificationToken',
    'session',
    'studentProfile',
    'employerProfile',
    'user',
    'department',
    'college',
  ] as const;

  for (const table of tables) {
    // The dynamic access is intentional; each name is from the fixed list above.
    await (prisma as unknown as Record<string, { deleteMany: () => Promise<unknown> }>)[table]!?.deleteMany?.();
  }

  console.log('   Cleared\n');
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error('\n❌ Seed failed\n');
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
