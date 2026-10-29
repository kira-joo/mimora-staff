import {
  MongoField,
  MongoSchema,
  Relation,
  createMongoModel,
} from "@kira-joo/backend-toolkit-mongoose";
import mongoose from "mongoose";

/**
 * Activity log for audit trail.
 *
 * Records staff actions on entities for compliance and debugging.
 *
 * **`entityId` is optional as of Phase 4A.5** (was `required: true`).
 * Building the automatic route-factory-level writer
 * (`core/activity/record-activity.ts`) surfaced a real gap: not every
 * audited action targets exactly one entity — a permission sync, a bulk
 * stock adjustment, or a read-only `ACTIVITY.READ` action has no single id
 * to attach. A required field forced every one of those writes to fail
 * validation (caught, logged, and silently dropped by the writer's own
 * failure handling) — which would have quietly reintroduced the "zero
 * writers" defect this whole mechanism exists to prevent, just for a
 * different subset of actions than `restaurant-platform-staff` originally
 * hit. `entityType`/`action` alone are still enough to say what happened.
 */
@MongoSchema({ timestamps: true })
export class ActivityLogSchema {
  _id!: mongoose.Types.ObjectId;

  @Relation(() => StaffUserSchema)
  @MongoField({ type: mongoose.Schema.Types.ObjectId, required: true, ref: "StaffUser" })
  actorId!: mongoose.Types.ObjectId;

  @MongoField({ type: String, required: true })
  action!: string;

  @MongoField({ type: String, required: true })
  entityType!: string;

  @MongoField({ type: mongoose.Schema.Types.ObjectId, required: false })
  entityId?: mongoose.Types.ObjectId;

  @MongoField({ type: mongoose.Schema.Types.Mixed, required: false })
  changes?: Record<string, unknown>;

  @MongoField({ type: String, required: false })
  ipAddress?: string;

  @MongoField({ type: String, required: false })
  userAgent?: string;
}

// Forward declaration
class StaffUserSchema {
  _id!: mongoose.Types.ObjectId;
}

export const ActivityLogModel = createMongoModel("ActivityLog", ActivityLogSchema);
