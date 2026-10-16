/**
 * Site configuration, including every placeholder value the brief calls for.
 *
 * ⚠️ **Everything in `PLACEHOLDER_*` is illustrative, not measured.** The landing
 * page renders these with a visible "placeholder" note so nobody mistakes them for
 * real platform metrics. Replace them with live counts from
 * `GET /analytics/platform` once the platform has real usage, and delete the note.
 */

export const siteConfig = {
  name: 'CampusConnect',
  tagline: 'From Campus Experience to Career Readiness',
  description:
    'CampusConnect unifies events, certificates, skill development, projects, internships and jobs into one continuous journey — so every campus experience builds toward employment.',
  url: process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000',

  contact: {
    email: 'hello@campusconnect.example',
    salesEmail: 'sales@campusconnect.example',
    phone: '+91 20 4000 0000',
    address: 'Pune, Maharashtra, India',
  },

  social: {
    linkedin: 'https://linkedin.example.com/company/campusconnect',
    twitter: 'https://twitter.example.com/campusconnect',
    youtube: 'https://youtube.example.com/@campusconnect',
  },
} as const;

/* -------------------------------------------------------------------------- */
/* PLACEHOLDER CONTENT — replace before launch                                */
/* -------------------------------------------------------------------------- */

/**
 * Landing-page statistics.
 *
 * These are fabricated round numbers used to lay out the marketing page. They are
 * rendered with a "(placeholder)" affordance so a demo does not misrepresent them.
 */
export const PLACEHOLDER_STATS = [
  { value: '10,000+', label: 'Students', description: 'Building their career record' },
  { value: '50+', label: 'Colleges', description: 'Across India' },
  { value: '500+', label: 'Events', description: 'Workshops, fests and competitions' },
  { value: '200+', label: 'Opportunities', description: 'Internships and jobs' },
] as const;

export const PLACEHOLDER_STATS_NOTE =
  'Illustrative platform metrics — placeholder values, not live data.';

/** Placeholder testimonials. The people are fictional. */
export const PLACEHOLDER_TESTIMONIALS = [
  {
    quote:
      'Every workshop I attended fed straight into my passport. By the time I applied, I had seven verified certificates and two reviewed projects — the interview was mostly about those.',
    name: 'Ananya Deshpande',
    role: 'BBA, Class of 2025',
    outcome: 'Placed — Retail Analytics',
    rating: 5,
  },
  {
    quote:
      'The readiness score showed me exactly what was missing. It sat at 41 until I did a mock interview, and that conversation changed how I answered everything after it.',
    name: 'Rohan Kulkarni',
    role: 'B.Com, Class of 2025',
    outcome: 'Placed — Financial Services',
    rating: 5,
  },
  {
    quote:
      'I stopped keeping a spreadsheet of my certificates. The verification link settled the one question recruiters kept asking — whether the certificates were real.',
    name: 'Sneha Iyer',
    role: 'B.Sc. Computer Science, final year',
    outcome: 'Two internship offers',
    rating: 4,
  },
  {
    quote:
      'As a placement officer, I can finally see which departments are actually engaging and where the skill gaps are. It replaced four spreadsheets and a monthly argument.',
    name: 'Meera Iyer',
    role: 'Placement Officer',
    outcome: 'XYZ College',
    rating: 5,
  },
] as const;

/** Placeholder partner logos. Rendered as typographic marks, not real brand assets. */
export const PLACEHOLDER_PARTNERS = [
  'XYZ College',
  'Sunrise Institute',
  'Northwind Analytics',
  'Vertex Retail',
  'Lumen Financial',
  'Pixelcraft Studios',
  'Cobalt Labs',
] as const;

export const PLACEHOLDER_NOTES = {
  logos: 'Placeholder partner names — no real organisation is represented.',
  testimonials: 'Placeholder testimonials — fictional students and outcomes.',
} as const;

/* -------------------------------------------------------------------------- */
/* Feature copy                                                               */
/* -------------------------------------------------------------------------- */

/**
 * "Everything You Need, In One Platform" cards.
 *
 * Each maps to a layer so the accent colour is derived rather than hand-picked,
 * which is what keeps the marketing page and the product feeling like one system.
 */
export const PLATFORM_FEATURES = [
  {
    key: 'events',
    layer: 'campusconnect' as const,
    title: 'Events',
    description:
      'Discover workshops, fests and club activities. Register in one click, carry a QR pass that works offline, and get your certificate automatically after you attend.',
    icon: 'CalendarDays',
    href: '/events',
  },
  {
    key: 'learn',
    layer: 'skillbridge' as const,
    title: 'Learn & Upskill',
    description:
      'Assess where you stand, follow a roadmap built from your gaps, and work through short courses with a completion certificate at the end.',
    icon: 'GraduationCap',
    href: '/learn',
  },
  {
    key: 'certificates',
    layer: 'campusconnect' as const,
    title: 'Certificates',
    description:
      'Every certificate carries a unique ID and a public verification link, so an employer can confirm it in one click — no phone calls to the college office.',
    icon: 'BadgeCheck',
    href: '/verify',
  },
  {
    key: 'internships',
    layer: 'skillbridge' as const,
    title: 'Internships',
    description:
      'Curated and employer-posted internships, plus industry projects that count as experience even before your first formal role.',
    icon: 'Briefcase',
    href: '/internships',
  },
  {
    key: 'jobs',
    layer: 'careerconnect' as const,
    title: 'Jobs',
    description:
      'Apply with your Career Passport attached. Track every application from applied through to offer, and get matched to roles your evidence actually supports.',
    icon: 'Target',
    href: '/jobs',
  },
] as const;

/* -------------------------------------------------------------------------- */
/* Audience pages                                                             */
/* -------------------------------------------------------------------------- */

export const AUDIENCES = {
  students: {
    title: 'For Students',
    headline: 'Everything you do on campus, in one place that gets you hired',
    description:
      'Stop rebuilding the same information into four different documents. Your events, certificates, skills, projects and internships collect into one passport that updates itself.',
    benefits: [
      { title: 'One profile that updates itself', description: 'Attend an event and the certificate appears. Finish a project and it joins your portfolio. Nothing is re-entered by hand.' },
      { title: 'Know what you are actually missing', description: 'The readiness score breaks into four evidence pillars — skills, projects, internship and interview — so you can see which one is holding you back.' },
      { title: 'Certificates employers can verify', description: 'Every certificate has a public verification link. A recruiter checks it in one click instead of calling the college office.' },
      { title: 'Practise before it counts', description: 'Mock interviews with mentors, or self-practice against a role question bank with feedback on your answers.' },
      { title: 'Apply with evidence attached', description: 'Your passport goes with every application, so the review is about what you have done rather than what you claim.' },
    ],
  },

  colleges: {
    title: 'For Colleges',
    headline: 'Run the campus calendar and placement readiness from one dashboard',
    description:
      'Replace the spreadsheets, the WhatsApp groups and the manual certificate signing with one system your coordinators will actually use.',
    benefits: [
      { title: 'One approval workflow', description: 'Club lead to faculty coordinator to admin, with every decision and note recorded on the event timeline.' },
      { title: 'Attendance that holds up', description: 'Signed QR passes that cannot be forged or reused, with manual override requiring a logged reason.' },
      { title: 'Certificates in bulk', description: 'Generate, email and publish hundreds of certificates after an event, each with a unique verifiable ID.' },
      { title: 'Engagement you can act on', description: 'Participation by department and year, registration versus attendance, and a per-student engagement score.' },
      { title: 'Placement readiness analytics', description: 'See readiness distribution, the skill gaps by department, and internship and placement outcomes in one view.' },
    ],
  },

  employers: {
    title: 'For Employers',
    headline: 'Screen on verified evidence, not on claims',
    description:
      'Every candidate arrives with a Career Passport: verified certificates, mentor-reviewed projects and internship history. Shortlist in minutes instead of weeks.',
    benefits: [
      { title: 'Evidence, not adjectives', description: 'Projects are reviewed against a rubric by a mentor. Certificates carry a public verification link. Skills are assessment-backed or clearly marked as self-declared.' },
      { title: 'Search with consent respected', description: 'You see candidates who have opted in. A student who withdraws consent loses visibility immediately — no stale exports.' },
      { title: 'Match scores you can explain', description: 'Every match shows the factors behind it, so your shortlist is defensible to your own hiring managers.' },
      { title: 'A pipeline that tracks itself', description: 'Kanban board from applied through to offer, with notes, interview scheduling and automated candidate updates.' },
      { title: 'Recruitment analytics', description: 'Applicants per posting, funnel conversion, time to hire, and which colleges your best hires come from.' },
    ],
  },
} as const;

/* -------------------------------------------------------------------------- */
/* Pricing                                                                    */
/* -------------------------------------------------------------------------- */

export const PRICING_PLANS = [
  {
    key: 'student',
    name: 'Student',
    price: 'Free',
    period: 'forever',
    description: 'Everything a student needs to build a verified career record.',
    features: [
      'Career Passport with public share link',
      'Event registration and QR passes',
      'Verified certificates with public verification',
      'Skill assessments and readiness score',
      'Free courses and project briefs',
      'Job and internship applications',
      'Resume builder — 2 templates',
    ],
    cta: 'Get started free',
    highlighted: false,
  },
  {
    key: 'premium-student',
    name: 'Student Premium',
    price: '₹299',
    period: 'per month',
    description: 'For final-year students who want the full preparation toolkit.',
    features: [
      'Everything in Free',
      'Mentor-led mock interviews',
      'Premium courses and career tracks',
      'Resume review with detailed suggestions',
      'All 4 resume templates',
      'Premium internship listings',
      'Priority mentor session booking',
    ],
    cta: 'Upgrade',
    highlighted: true,
    badge: 'Most popular with final years',
  },
  {
    key: 'college',
    name: 'College',
    price: 'Custom',
    period: 'per institution',
    description: 'For placement cells running a full campus programme.',
    features: [
      'Unlimited students and events',
      'Approval workflow with audit trail',
      'Bulk certificate generation and email',
      'QR attendance scanning',
      'Engagement and readiness analytics',
      'CSV exports for every report',
      'Placement drive management',
      'Dedicated onboarding for coordinators',
    ],
    cta: 'Book a demo',
    highlighted: false,
  },
  {
    key: 'employer',
    name: 'Employer',
    price: 'Custom',
    period: 'per company',
    description: 'For recruiters hiring from the campus pipeline.',
    features: [
      'Unlimited job and internship postings',
      'Candidate search with consent controls',
      'Match scores with explanations',
      'Applicant pipeline and kanban board',
      'Interview scheduling and reminders',
      'Recruitment and funnel analytics',
      'Campus drive coordination',
    ],
    cta: 'Talk to sales',
    highlighted: false,
  },
] as const;

/* -------------------------------------------------------------------------- */
/* Navigation                                                                 */
/* -------------------------------------------------------------------------- */

export const MARKETING_NAV = [
  { label: 'Home', href: '/' },
  { label: 'Events', href: '/events' },
  { label: 'Learn', href: '/learn' },
  { label: 'Internships', href: '/internships' },
  { label: 'Jobs', href: '/jobs' },
  { label: 'About', href: '/about' },
] as const;

export const MARKETING_FOOTER = {
  platform: [
    { label: 'Events', href: '/events' },
    { label: 'Learn & Upskill', href: '/learn' },
    { label: 'Internships', href: '/internships' },
    { label: 'Jobs', href: '/jobs' },
    { label: 'Verify a certificate', href: '/verify' },
  ],
  audiences: [
    { label: 'For Students', href: '/for-students' },
    { label: 'For Colleges', href: '/for-colleges' },
    { label: 'For Employers', href: '/for-employers' },
    { label: 'Pricing', href: '/pricing' },
  ],
  company: [
    { label: 'About', href: '/about' },
    { label: 'Contact', href: '/contact' },
    { label: 'Book a demo', href: '/contact?intent=demo' },
  ],
  legal: [
    { label: 'Privacy Policy', href: '/legal/privacy' },
    { label: 'Terms of Service', href: '/legal/terms' },
    { label: 'Data & Consent', href: '/legal/data-consent' },
  ],
} as const;

/** Suggested search terms on the landing-page search bar. */
export const SEARCH_SUGGESTIONS = [
  'Excel workshop',
  'Power BI',
  'Hackathon',
  'Digital marketing',
  'Mock interview',
  'Data analyst internship',
] as const;
