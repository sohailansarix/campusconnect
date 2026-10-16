import type { Request, Response } from 'express';
import type { z } from 'zod';
import { clubSchemas, commonSchemas } from '@campusconnect/shared';
import * as clubService from './club.service.js';
import { requireUser } from '../../middleware/auth.js';
import { auditContextOf } from '../../utils/requestContext.js';

function callerOf(req: Request) {
  const user = requireUser(req);
  return {
    id: user.id,
    collegeId: user.collegeId,
    role: user.role,
    isSuperAdmin: user.role === 'SUPER_ADMIN',
  };
}

/* -------------------------------------------------------------------------- */
/* Clubs                                                                      */
/* -------------------------------------------------------------------------- */

export async function list(req: Request, res: Response): Promise<void> {
  const caller = callerOf(req);
  const filters = req.query as z.infer<typeof clubSchemas.clubListQuerySchema>;

  const result = await clubService.list(filters, caller);
  res.json({ success: true, data: result.items, meta: result.meta });
}

export async function getById(req: Request, res: Response): Promise<void> {
  const caller = callerOf(req);
  const { id } = req.params as z.infer<typeof commonSchemas.idParamSchema>;

  const club = await clubService.getById(id, { viewerId: caller.id });
  res.json({ success: true, data: club });
}

export async function create(req: Request, res: Response): Promise<void> {
  const caller = callerOf(req);
  const body = req.body as z.infer<typeof clubSchemas.createClubSchema>;

  const club = await clubService.create(body, caller, auditContextOf(req));
  res.status(201).json({ success: true, data: club });
}

export async function update(req: Request, res: Response): Promise<void> {
  const caller = callerOf(req);
  const { id } = req.params as z.infer<typeof commonSchemas.idParamSchema>;
  const body = req.body as z.infer<typeof clubSchemas.updateClubSchema>;

  const club = await clubService.update(id, body, caller, auditContextOf(req));
  res.json({ success: true, data: club });
}

export async function remove(req: Request, res: Response): Promise<void> {
  const caller = callerOf(req);
  const { id } = req.params as z.infer<typeof commonSchemas.idParamSchema>;

  await clubService.softDelete(id, caller, auditContextOf(req));
  res.status(204).send();
}

/* -------------------------------------------------------------------------- */
/* Membership                                                                 */
/* -------------------------------------------------------------------------- */

export async function join(req: Request, res: Response): Promise<void> {
  const caller = callerOf(req);
  const { id } = req.params as z.infer<typeof commonSchemas.idParamSchema>;
  const body = req.body as z.infer<typeof clubSchemas.joinClubSchema>;

  const membership = await clubService.requestMembership(id, caller.id, body, auditContextOf(req));

  res.status(201).json({
    success: true,
    data: {
      ...membership,
      message:
        membership.status === 'PENDING'
          ? 'Your request has been sent to the club lead for review.'
          : 'You are a member of this club.',
    },
  });
}

export async function leave(req: Request, res: Response): Promise<void> {
  const caller = callerOf(req);
  const { id } = req.params as z.infer<typeof commonSchemas.idParamSchema>;

  await clubService.leaveClub(id, caller.id, auditContextOf(req));
  res.json({ success: true, data: { left: true } });
}

export async function listMembers(req: Request, res: Response): Promise<void> {
  const { id } = req.params as z.infer<typeof commonSchemas.idParamSchema>;
  const query = req.query as z.infer<typeof clubSchemas.membershipListQuerySchema>;

  const result = await clubService.listMembers(id, {
    page: query.page,
    pageSize: query.pageSize,
    status: query.status,
    role: query.role,
    search: query.search,
  });

  res.json({ success: true, data: result.items, meta: result.meta });
}

export async function pendingRequests(req: Request, res: Response): Promise<void> {
  const caller = callerOf(req);
  const query = req.query as z.infer<typeof clubSchemas.membershipListQuerySchema>;

  const result = await clubService.listPendingRequests(caller, {
    page: query.page,
    pageSize: query.pageSize,
    clubId: query.clubId,
  });

  res.json({ success: true, data: result.items, meta: result.meta });
}

export async function reviewMembership(req: Request, res: Response): Promise<void> {
  const caller = callerOf(req);
  const { membershipId } = req.params as { membershipId: string };
  const body = req.body as z.infer<typeof clubSchemas.updateMembershipSchema>;

  // A review must resolve to a terminal state; PENDING is not a decision.
  const status = body.status === 'ACTIVE' ? 'ACTIVE' : 'REJECTED';

  await clubService.reviewMembership(
    membershipId,
    { status, role: body.role, reviewNote: body.reviewNote },
    caller,
    auditContextOf(req),
  );

  res.json({
    success: true,
    data: {
      id: membershipId,
      status,
      message: status === 'ACTIVE' ? 'Membership approved.' : 'Request declined.',
    },
  });
}

export async function refreshCounters(req: Request, res: Response): Promise<void> {
  const { id } = req.params as z.infer<typeof commonSchemas.idParamSchema>;
  await clubService.refreshCounters(id);
  res.json({ success: true, data: { refreshed: true } });
}
