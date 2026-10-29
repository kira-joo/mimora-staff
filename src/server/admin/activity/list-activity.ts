import type { PaginatedResponse } from "@kira-joo/toolkit-common";
import { activityLogRepository, staffUserRepository } from "../../core/repositories";
import type { ListActivityQueryDto } from "../dto/list-activity-query.dto";

export interface ActivityEntryView {
  _id: string;
  actor: { _id: string; name?: string; email?: string };
  action: string;
  entityType: string;
  entityId?: string;
  changes?: Record<string, unknown>;
  ipAddress?: string;
  at: Date;
}

/**
 * The audit log, newest first (the toolkit's own `createdAt` default),
 * filterable by actor, entity, action and time — `entityType` + `entityId`
 * together is one record's full history.
 *
 * Read-only by design: there is no write, update or delete route for this
 * collection. Entries are written only by `recordActivity`, from the route
 * factory, after every audited mutation.
 */
export async function listActivity(query: ListActivityQueryDto): Promise<PaginatedResponse<ActivityEntryView>> {
  const { actorId, entityType, entityId, action, from, to, ...rest } = query;
  const where: Record<string, unknown> = {};

  if (actorId) where.actorId = actorId;
  if (entityType) where.entityType = entityType;
  if (entityId) where.entityId = entityId;
  if (action) where.action = action;
  if (from || to) {
    where.createdAt = {
      ...(from ? { $gte: new Date(from) } : {}),
      ...(to ? { $lte: new Date(to) } : {}),
    };
  }

  const result = await activityLogRepository.findAllAndCountPublic({ where, query: rest });

  const actorIds = [...new Set(result.data.map((entry) => entry.actorId.toString()))];
  const actors = await staffUserRepository.findByIds(actorIds, { select: { name: true, email: true } });
  const actorById = new Map(actors.map((actor) => [actor._id.toString(), actor]));

  return {
    ...result,
    data: result.data.map((entry) => {
      const actor = actorById.get(entry.actorId.toString());
      return {
        _id: entry._id.toString(),
        // A deactivated staff member is still found here — there is no staff DELETE, so an actor never disappears.
        actor: { _id: entry.actorId.toString(), name: actor?.name, email: actor?.email },
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId?.toString(),
        changes: entry.changes,
        ipAddress: entry.ipAddress,
        at: (entry as { createdAt?: Date }).createdAt!,
      };
    }),
  };
}
