import { MongoField, MongoSchema, Unique, createMongoModel } from "@kira-joo/backend-toolkit-mongoose";
import mongoose from "mongoose";

/**
 * Backing store for `@kira-joo/backend-toolkit-next`'s `IdempotencyStore`
 * interface. Phase 4A.5 rewrite — the prior shape (`route`, `actorId`,
 * `responseStatus`, `responseBody` as separate top-level fields) was a
 * bespoke, hand-rolled design that never actually wired into the toolkit's
 * `idempotent: true` route option; this shape matches
 * `IdempotencyRecord {status, body, requestHash}` exactly, because
 * `mongo-idempotency-store.ts` persists that interface directly.
 *
 * `status`/`body` are **absent** while a request is still in flight — the
 * insert that claims a key happens before the handler runs, and `complete()`
 * fills them in afterward. A record with no `status` is exactly how
 * `begin()` tells two concurrent callers apart: present means "replay this,"
 * absent means "someone else is still working on it."
 *
 * **Scoping by route and actor before uniqueness** (this repo's own
 * `CLAUDE.md` non-negotiable #8) is a convention enforced by how `key` is
 * constructed — `buildIdempotencyKey()` in `mongo-idempotency-store.ts` —
 * not a separate schema field. `key` alone carries `@Unique()`, and the
 * scoping lives inside the string it uniquely constrains.
 */
@MongoSchema({ timestamps: true })
export class IdempotencyRecordSchema {
  _id!: mongoose.Types.ObjectId;

  @Unique()
  @MongoField({ type: String, required: true })
  key!: string;

  @MongoField({ type: String, required: true })
  requestHash!: string;

  @MongoField({ type: Number, required: false })
  status?: number;

  @MongoField({ type: mongoose.Schema.Types.Mixed, required: false })
  body?: unknown;

  /** TTL — a completed or abandoned claim does not need to outlive the window a client could plausibly retry within. */
  @MongoField({ type: Date, required: true, expires: 0 })
  expiresAt!: Date;
}

export const IdempotencyRecordModel = createMongoModel("IdempotencyRecord", IdempotencyRecordSchema);
