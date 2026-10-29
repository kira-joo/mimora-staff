import { MongoField, MongoSchema, createMongoModel } from "@kira-joo/backend-toolkit-mongoose";
import mongoose from "mongoose";
import { STAFF_NOTIFICATION_TYPES, type StaffNotificationType } from "../engines/notifications/staff-notification-policy";

/**
 * How long a notice is kept. A notice is a nudge ("a new order arrived"), not a record: the order, return or variant it
 * points at is the record. 90 days is long enough for anyone returning from leave to see what they missed, and keeps
 * the collection from growing for the life of the store.
 */
export const STAFF_NOTIFICATION_RETENTION_DAYS = 90;
export const STAFF_NOTIFICATION_RETENTION_MS = STAFF_NOTIFICATION_RETENTION_DAYS * 24 * 60 * 60 * 1000;

/**
 * StaffNotification — one in-app notice for the console ("a new order", "a
 * payment proof arrived", "a return was requested", "a variant is running
 * low").
 *
 * **One document per event, not per recipient.** Who may see it is decided at
 * READ time by the permission that guards the underlying record
 * (`NOTIFICATION_TYPE_PERMISSION`), so a role granted access tomorrow sees
 * today's notices, and nothing is fanned out across every staff account.
 *
 * **Read state is a per-staff set** (`readBy`), not a flag: one person
 * clearing their bell must not clear it for the colleague next to them.
 *
 * Carries no customer data — a title names an order number or a SKU, never a
 * person — and a link into the console that opens the record.
 *
 * No `timestamps`: `at` is the event time and the only time that is read, and
 * `_id` (the default sort) is time-ordered.
 *
 * **Expires.** `expiresAt` carries a TTL index (`expireAfterSeconds: 0`), so MongoDB removes a notice
 * {@link STAFF_NOTIFICATION_RETENTION_DAYS} days after the event; the background monitor runs about once a minute, so
 * removal is approximate. It is a SEPARATE field rather than a TTL on `at`: `at` already carries a plain index in
 * existing databases, and MongoDB refuses to turn an index of the same key into a TTL one
 * (`IndexOptionsConflict`), which would stop this process booting against them. Notices written before this field
 * existed have none and are never removed; the one-line backfill is in `docs/configuration.md`.
 */
@MongoSchema({ timestamps: false })
export class StaffNotificationSchema {
  _id!: mongoose.Types.ObjectId;

  @MongoField({ type: String, enum: [...STAFF_NOTIFICATION_TYPES], required: true, index: true })
  type!: StaffNotificationType;

  @MongoField({ type: String, required: true })
  title!: string;

  @MongoField({ type: String, required: false })
  body?: string;

  /** A console route (`/orders/<id>`), never an absolute URL. */
  @MongoField({ type: String, required: true })
  link!: string;

  @MongoField({ type: String, enum: ["Order", "Return", "Variant"], required: true })
  entityType!: "Order" | "Return" | "Variant";

  @MongoField({ type: mongoose.Schema.Types.ObjectId, required: true })
  entityId!: mongoose.Types.ObjectId;

  /** The staff members who have read it. */
  @MongoField({ type: [mongoose.Schema.Types.ObjectId], default: () => [] })
  readBy!: mongoose.Types.ObjectId[];

  @MongoField({ type: Date, required: true, default: () => new Date(), index: true })
  at!: Date;

  /** TTL anchor: `at` + the retention period. Mongo deletes the document once this passes. */
  @MongoField({ type: Date, required: false, expires: 0, default: () => new Date(Date.now() + STAFF_NOTIFICATION_RETENTION_MS) })
  expiresAt?: Date;
}

export const StaffNotificationModel = createMongoModel("StaffNotification", StaffNotificationSchema);
