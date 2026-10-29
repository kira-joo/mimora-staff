import { MongoField, MongoSchema, Unique, createMongoModel } from "@kira-joo/backend-toolkit-mongoose";
import mongoose from "mongoose";

/**
 * Rate-limit counters — new in Phase 4A.5. No `@kira-joo` package provides
 * this (confirmed by the architecture review: grepped every package, zero
 * hits beyond an unrelated doc comment). Modelled on
 * `restaurant-platform-staff`'s proven Mongo-backed fixed-window design, not
 * copied verbatim — that repo hand-rolls a raw `mongoose.Schema`; this one
 * uses the same `@MongoSchema`/`@MongoField`/`@Unique()` decorator
 * convention every other schema in this repo already follows, so
 * `ensureIndexes()`'s boot-time assertion covers it the same way it covers
 * every other unique/TTL index in this application.
 *
 * See `enforce-rate-limit.ts` for the atomic increment and the fixed-window
 * rationale (a sustained attacker cannot push the window forward — anchored
 * to the first attempt via `$setOnInsert`).
 */
@MongoSchema({ timestamps: false })
export class RateLimitSchema {
  _id!: mongoose.Types.ObjectId;

  /** Namespaced by caller, e.g. `login:203.0.113.4`. */
  @Unique()
  @MongoField({ type: String, required: true })
  key!: string;

  @MongoField({ type: Number, required: true, default: 0 })
  count!: number;

  /** TTL anchor — Mongo removes the document once the window closes, so nothing accumulates. */
  @MongoField({ type: Date, required: true, expires: 0 })
  expiresAt!: Date;
}

export const RateLimitModel = createMongoModel("RateLimit", RateLimitSchema);
