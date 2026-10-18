# Project TODO and completion log

## Completed

### Phase 2 implementation

- [x] Implement skill assessments, career roadmaps, courses, mentor-reviewed projects, internships, resume builder, and Career Passport.
- [x] Show passport evidence in the dashboard journey and surface the highest-impact available readiness action.
- [x] Return detailed readiness actions only to the passport owner; keep Phase 3 mock-interview actions out of the Phase 2 dashboard.
- [x] Fix assessment and internship recommendation links.
- [x] Remove stale Phase 2 TODO markers and classify remaining cross-phase work below.

### Phase 1 carryovers

- [x] Load full-month public event calendars and preserve the active event filters.
- [x] Apply available-seat filtering before pagination with accurate result totals.

### Database setup

- [x] Seed the configured Supabase database with demo data: 2 colleges, 49 students plus staff and employers, 20 events, and related learning, project, and internship records.

## Future work

## Phase 3

- [ ] Replace notification polling with server-sent events. [Notification hook](./apps/web/src/hooks/use-notifications.ts)
- [ ] Build mock-interview booking and self-practice flows.
- [ ] Build CareerConnect job discovery, employer profiles, candidate search, application pipelines, and interview scheduling.
- [ ] Add premium-service gating and the upgrade flow.
- [ ] Add advanced placement and recruitment analytics.

## Phase 4

- [ ] Add unit and integration tests for authentication, events, attendance, and applications.
- [ ] Add end-to-end coverage for the main student journeys.
- [ ] Connect production error monitoring.
- [ ] Move rate limiting to Redis for multi-instance deployments.
- [ ] Materialize analytics into scheduled rollups at scale.
- [ ] Define and implement the S3 public-object policy.
- [ ] Add push, WhatsApp, and SMS delivery adapters.
- [ ] Bundle Noto fonts for Unicode PDF output. [PDF utility](./apps/api/src/utils/pdf.ts)

## Future AI improvements

- [ ] Replace rule-based readiness, recommendations, job matching, skill-gap analysis, learning paths, resume suggestions, and interview feedback with model-backed implementations where data and evaluation support them.
