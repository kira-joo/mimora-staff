import { MongoField, MongoSchema, createMongoModel } from "@kira-joo/backend-toolkit-mongoose";
import mongoose from "mongoose";

/**
 * NotificationSettings — new in Phase 4A.5 (MDS §8.1, §21, D-8).
 *
 * Per-event channel toggles and recipient roles. `channels` mirrors
 * `engines/notifications/outbound-notifier.ts`'s `NotificationChannel`
 * union (`"EMAIL" | "SMS"`) rather than importing it — an engine type and a
 * persisted document schema are independent declarations for the same
 * reason `@MongoField({type:...})` never checks itself against a TS
 * interface (see this repo's own `CLAUDE.md`); keeping the string literal
 * here local avoids a schema file depending on an engine module.
 *
 * No transport exists yet (D-8) — this configures WHICH events a merchant
 * wants notified about and to which roles, independent of whether delivery
 * is currently wired up. `createNoOpOutboundNotifier` already announces the
 * transport gap loudly at boot; this schema does not change that.
 *
 * Singleton per deployment, same convention as `StoreProfile`.
 */
@MongoSchema({ timestamps: true })
export class NotificationSettingsSchema {
  _id!: mongoose.Types.ObjectId;

  @MongoField({
    type: [
      new mongoose.Schema(
        {
          event: { type: String, required: true },
          channels: { type: [String], enum: ["EMAIL", "SMS"], default: () => [] },
          recipientRoles: { type: [String], default: () => [] },
        },
        { _id: false }
      ),
    ],
    default: () => [],
  })
  events!: Array<{ event: string; channels: Array<"EMAIL" | "SMS">; recipientRoles: string[] }>;
}

export const NotificationSettingsModel = createMongoModel("NotificationSettings", NotificationSettingsSchema);
