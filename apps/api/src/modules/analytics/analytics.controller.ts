import type { Request, Response } from 'express';
import type { z } from 'zod';
import { analyticsSchemas, commonSchemas } from '@campusconnect/shared';
import * as analyticsService from './analytics.service.js';
import { requireUser } from '../../middleware/auth.js';
import { auditAction } from '../../utils/audit.js';
import { auditContextOf } from '../../utils/requestContext.js';
import { sendCsv, csvFilename, toCsv, formatDateTime } from '../../utils/csv.js';
import { prisma } from '../../config/prisma.js';
import { ValidationError } from '../../utils/errors.js';

/**
 * Analytics controller.
 *
 * Reads are college-scoped by the service. Exports additionally write an audit row:
 * "who downloaded the list of every student with their phone numbers" is exactly
 * the question an institution asks after a data incident, and it cannot be answered
 * retrospectively.
 */

function scopeOf(req: Request): analyticsService.AnalyticsScope {
  const user = requireUser(req);
  return {
    collegeId: user.collegeId,
    isSuperAdmin: user.role === 'SUPER_ADMIN',
    departmentId: user.departmentId,
  };
}

/* -------------------------------------------------------------------------- */
/* Dashboards                                                                 */
/* -------------------------------------------------------------------------- */

export async function overview(req: Request, res: Response): Promise<void> {
  const query = req.query as z.infer<typeof analyticsSchemas.analyticsRangeSchema>;

  const result = await analyticsService.collegeOverview(scopeOf(req), {
    from: query.from,
    to: query.to,
  });

  res.json({ success: true, data: result });
}

export async function eventEngagement(req: Request, res: Response): Promise<void> {
  const query = req.query as z.infer<typeof analyticsSchemas.eventAnalyticsQuerySchema>;

  const result = await analyticsService.eventEngagement(scopeOf(req), {
    from: query.from,
    to: query.to,
    granularity: query.granularity,
    eventId: query.eventId,
    category: query.category,
  });

  res.json({ success: true, data: result });
}

export async function participation(req: Request, res: Response): Promise<void> {
  const query = req.query as z.infer<typeof analyticsSchemas.analyticsRangeSchema>;

  const result = await analyticsService.participationBreakdown(scopeOf(req), {
    from: query.from,
    to: query.to,
  });

  res.json({ success: true, data: result });
}

export async function readiness(req: Request, res: Response): Promise<void> {
  const query = req.query as z.infer<typeof analyticsSchemas.placementAnalyticsQuerySchema>;

  const result = await analyticsService.readinessAnalytics(scopeOf(req), {
    from: query.from,
    to: query.to,
    departmentId: query.departmentId,
    graduationYear: query.graduationYear,
  });

  res.json({ success: true, data: result });
}

export async function studentEngagement(req: Request, res: Response): Promise<void> {
  const query = req.query as z.infer<typeof analyticsSchemas.analyticsRangeSchema> & {
    page?: number;
    pageSize?: number;
    search?: string;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
  };

  const result = await analyticsService.studentEngagement(scopeOf(req), {
    page: query.page ?? 1,
    pageSize: query.pageSize ?? 25,
    departmentId: query.departmentId,
    graduationYear: query.graduationYear,
    search: query.search,
    sortBy: query.sortBy,
    sortOrder: query.sortOrder,
  });

  res.json({ success: true, data: result.items, meta: result.meta });
}

export async function platform(req: Request, res: Response): Promise<void> {
  const result = await analyticsService.platformOverview();
  res.json({ success: true, data: result });
}

/* -------------------------------------------------------------------------- */
/* Exports                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Single CSV export endpoint for every report.
 *
 * One endpoint rather than seven keeps the audit trail, rate limit and column
 * definitions in one place — and a report is a read, so a discriminated union over
 * `report` is simpler than seven routes.
 */
export async function exportReport(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const query = req.query as z.infer<typeof analyticsSchemas.exportQuerySchema>;
  const scope = scopeOf(req);

  const { from, to } = analyticsService.resolveRange(query.from, query.to);

  let csv: string;
  let filename: string;

  switch (query.report) {
    case 'STUDENT_ENGAGEMENT': {
      const result = await analyticsService.studentEngagement(scope, {
        page: 1,
        // Exports are not paginated in the UI — the officer wants the full list.
        pageSize: 5000,
        departmentId: query.departmentId,
        graduationYear: query.graduationYear,
      });

      csv = toCsv(result.items, [
        { header: 'Name', value: (s) => s.fullName },
        { header: 'Email', value: (s) => s.email },
        { header: 'Roll No', value: (s) => s.rollNumber },
        { header: 'Department', value: (s) => s.department?.code },
        { header: 'Graduation Year', value: (s) => s.graduationYear },
        { header: 'Events Registered', value: (s) => s.eventsRegistered },
        { header: 'Events Attended', value: (s) => s.eventsAttended },
        { header: 'No-show Rate %', value: (s) => s.noShowRate },
        { header: 'Categories Attended', value: (s) => s.categoriesAttended },
        { header: 'Certificates', value: (s) => s.certificates },
        { header: 'Readiness Score', value: (s) => s.readinessScore },
        { header: 'Engagement Score', value: (s) => s.engagementScore },
        { header: 'Engagement Band', value: (s) => s.band },
      ]);
      filename = csvFilename('student-engagement', from, to);
      break;
    }

    case 'EVENT_ENGAGEMENT': {
      const engagement = await analyticsService.eventEngagement(scope, {
        from,
        to,
        granularity: query.granularity,
      });

      csv = toCsv(engagement.popularCategories, [
        { header: 'Category', value: (c) => c.category },
        { header: 'Events', value: (c) => c.count },
        { header: 'Registrations', value: (c) => c.registrations },
        { header: 'Attendance', value: (c) => c.attendance },
        { header: 'Attendance Rate %', value: (c) => c.attendanceRate },
        { header: 'Average Rating', value: (c) => c.averageRating },
      ]);
      filename = csvFilename('event-engagement-by-category', from, to);
      break;
    }

    case 'ATTENDANCE': {
      const events = await prisma.event.findMany({
        where: {
          ...(scope.isSuperAdmin ? {} : { collegeId: scope.collegeId }),
          deletedAt: null,
          startAt: { gte: from, lte: to },
        },
        orderBy: { startAt: 'desc' },
        select: {
          title: true,
          startAt: true,
          endAt: true,
          category: true,
          mode: true,
          status: true,
          capacity: true,
          registrationCount: true,
          attendanceCount: true,
          averageRating: true,
          club: { select: { name: true } },
          department: { select: { code: true } },
          organizer: { select: { fullName: true } },
        },
      });

      csv = toCsv(events, [
        { header: 'Event', value: (e) => e.title },
        { header: 'Category', value: (e) => e.category },
        { header: 'Mode', value: (e) => e.mode },
        { header: 'Status', value: (e) => e.status },
        { header: 'Starts', value: (e) => formatDateTime(e.startAt) },
        { header: 'Ends', value: (e) => formatDateTime(e.endAt) },
        { header: 'Club', value: (e) => e.club?.name },
        { header: 'Department', value: (e) => e.department?.code },
        { header: 'Organiser', value: (e) => e.organizer.fullName },
        { header: 'Capacity', value: (e) => e.capacity },
        { header: 'Registrations', value: (e) => e.registrationCount },
        { header: 'Attendance', value: (e) => e.attendanceCount },
        {
          header: 'Attendance Rate %',
          value: (e) => (e.registrationCount > 0 ? Math.round((e.attendanceCount / e.registrationCount) * 100) : 0),
        },
        { header: 'Average Rating', value: (e) => (e.averageRating ? Number(e.averageRating) : null) },
      ]);
      filename = csvFilename('event-attendance', from, to);
      break;
    }

    case 'CERTIFICATES': {
      const certificates = await prisma.certificate.findMany({
        where: {
          ...(scope.isSuperAdmin ? {} : { collegeId: scope.collegeId }),
          deletedAt: null,
          issuedAt: { gte: from, lte: to },
        },
        orderBy: { issuedAt: 'desc' },
        select: {
          certificateId: true,
          title: true,
          type: true,
          status: true,
          issuedAt: true,
          revokedReason: true,
          student: {
            select: {
              fullName: true,
              email: true,
              department: { select: { code: true } },
              studentProfile: { select: { rollNumber: true } },
            },
          },
          event: { select: { title: true } },
        },
      });

      csv = toCsv(certificates, [
        { header: 'Certificate ID', value: (c) => c.certificateId },
        { header: 'Student', value: (c) => c.student.fullName },
        { header: 'Email', value: (c) => c.student.email },
        { header: 'Roll No', value: (c) => c.student.studentProfile?.rollNumber },
        { header: 'Department', value: (c) => c.student.department?.code },
        { header: 'Title', value: (c) => c.title },
        { header: 'Type', value: (c) => c.type },
        { header: 'Status', value: (c) => c.status },
        { header: 'Event', value: (c) => c.event?.title },
        { header: 'Issued At', value: (c) => formatDateTime(c.issuedAt) },
        { header: 'Revoke Reason', value: (c) => c.revokedReason },
      ]);
      filename = csvFilename('certificates', from, to);
      break;
    }

    case 'PLACEMENT_FUNNEL':
    case 'DEPARTMENT_COMPARISON': {
      const readiness = await analyticsService.readinessAnalytics(scope, {
        from,
        to,
        departmentId: query.departmentId,
        graduationYear: query.graduationYear,
      });

      if (query.report === 'PLACEMENT_FUNNEL') {
        csv = toCsv(readiness.placementFunnel.stages, [
          { header: 'Stage', value: (s) => s.label },
          { header: 'Candidates', value: (s) => s.count },
          { header: 'Percentage', value: (s) => s.percentage },
        ]);
        filename = csvFilename('placement-funnel', from, to);
      } else {
        csv = toCsv(readiness.byDepartment, [
          { header: 'Department', value: (d) => d.departmentName },
          { header: 'Code', value: (d) => d.code },
          { header: 'Students', value: (d) => d.students },
          { header: 'Average Readiness', value: (d) => d.averageScore },
          { header: 'Below 60', value: (d) => d.belowSixty },
          { header: 'At Risk %', value: (d) => d.atRiskPercentage },
        ]);
        filename = csvFilename('department-readiness', from, to);
      }
      break;
    }

    case 'APPLICATIONS': {
      if (!scope.collegeId && !scope.isSuperAdmin) {
        throw new ValidationError('Your account is not linked to a college');
      }

      const applications = await prisma.application.findMany({
        where: {
          ...(scope.isSuperAdmin ? {} : { collegeId: scope.collegeId }),
          deletedAt: null,
          appliedAt: { gte: from, lte: to },
        },
        orderBy: { appliedAt: 'desc' },
        take: 20_000,
        select: {
          status: true,
          matchScore: true,
          appliedAt: true,
          shortlistedAt: true,
          offeredAt: true,
          hiredAt: true,
          rejectReason: true,
          user: {
            select: {
              fullName: true,
              email: true,
              department: { select: { code: true } },
              studentProfile: { select: { rollNumber: true, readinessScore: true } },
            },
          },
          job: {
            select: {
              title: true,
              employer: { select: { companyName: true } },
            },
          },
        },
      });

      csv = toCsv(applications, [
        { header: 'Student', value: (a) => a.user.fullName },
        { header: 'Email', value: (a) => a.user.email },
        { header: 'Roll No', value: (a) => a.user.studentProfile?.rollNumber },
        { header: 'Department', value: (a) => a.user.department?.code },
        { header: 'Readiness', value: (a) => a.user.studentProfile?.readinessScore },
        { header: 'Role', value: (a) => a.job?.title },
        { header: 'Company', value: (a) => a.job?.employer?.companyName },
        { header: 'Status', value: (a) => a.status },
        { header: 'Match Score', value: (a) => a.matchScore },
        { header: 'Applied', value: (a) => formatDateTime(a.appliedAt) },
        { header: 'Shortlisted', value: (a) => formatDateTime(a.shortlistedAt) },
        { header: 'Offered', value: (a) => formatDateTime(a.offeredAt) },
        { header: 'Hired', value: (a) => formatDateTime(a.hiredAt) },
        { header: 'Reject Reason', value: (a) => a.rejectReason },
      ]);
      filename = csvFilename('applications', from, to);
      break;
    }

    default:
      throw new ValidationError('Unknown report');
  }

  /*
   * The audit row is written before the response is sent, so an interrupted
   * download still records that the data was requested.
   */
  auditAction(auditContextOf(req), 'EXPORT', 'AnalyticsReport', null, {
    report: query.report,
    format: query.format,
    from: from.toISOString(),
    to: to.toISOString(),
    departmentId: query.departmentId,
    graduationYear: query.graduationYear,
  });

  sendCsv(res, csv, filename);
}

export { commonSchemas };
