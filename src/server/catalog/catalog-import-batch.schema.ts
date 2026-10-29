import { MongoField, MongoSchema, createMongoModel } from "@kira-joo/backend-toolkit-mongoose";
import mongoose from "mongoose";

/**
 * CatalogImportBatch — a staged bulk catalog/inventory revision, per MDS
 * §8.3 and §12. New in this pass (same status as `StockMovement` — not in
 * Phase 4A.5's own checklist, found genuinely missing by the Phase 4B
 * verification pass).
 *
 * **The whole reason this entity exists**: MDS §12 ("Bulk import never
 * invalidates") — a script or worker stages rows here and computes their
 * rollups, but never mutates live catalog data and never publishes a cache
 * invalidation. Only an authenticated `POST /api/admin/catalog/publish`
 * (already accounted for in the canonical route inventory) flips a
 * `STAGED` batch to `PUBLISHED` and declares the tags. This schema is what
 * that route reads and transitions — without it, `catalog/publish` has
 * nothing to publish.
 *
 * `rows`/`rowErrors[]`/`warnings[]` are `Mixed` rather than a strict sub-schema:
 * the shape of a staged row is the importer's (`server/admin/catalog-import`,
 * documented in `docs/catalog-import.md`), not this schema's. `rows` holds the
 * parsed products with their variants, each carrying the CSV line it came
 * from, so a problem can always be traced back to the file.
 *
 * `filename`, `summary` and `publishResult` are additive: the file the batch
 * was staged from, what publishing it would do (counts, computed at staging,
 * nothing applied), and what publishing actually did.
 *
 * **`rowErrors`, not MDS's literal `errors`**: Mongoose reserves `errors`
 * as a document pathname (its own validation-error collection) and warns
 * at schema-build time that using it "may break some functionality" —
 * confirmed by actually building this schema with the literal name during
 * this pass. `rowErrors` carries the identical meaning MDS §8.3 intends
 * without colliding with the ODM's own reserved surface.
 */
@MongoSchema({ timestamps: true })
export class CatalogImportBatchSchema {
  _id!: mongoose.Types.ObjectId;

  @MongoField({ type: String, enum: ["STAGED", "PUBLISHED", "DISCARDED"], default: "STAGED" })
  status!: "STAGED" | "PUBLISHED" | "DISCARDED";

  @MongoField({ type: mongoose.Schema.Types.Mixed, required: true })
  rows!: unknown;

  @MongoField({ type: [mongoose.Schema.Types.Mixed], default: () => [] })
  rowErrors!: unknown[];

  /** Non-blocking notes (a missing secondary-locale name, a compare-at price that is not above the price). Same shape as `rowErrors`. */
  @MongoField({ type: [mongoose.Schema.Types.Mixed], default: () => [] })
  warnings!: unknown[];

  /** The uploaded file's name, for the list. Never its content. */
  @MongoField({ type: String, required: false })
  filename?: string;

  /** What publishing would do, counted at staging. Nothing it describes has happened. */
  @MongoField({ type: mongoose.Schema.Types.Mixed, required: false })
  summary?: unknown;

  /** What publishing did — the counts actually applied. Absent until `PUBLISHED`. */
  @MongoField({ type: mongoose.Schema.Types.Mixed, required: false })
  publishResult?: unknown;

  @MongoField({ type: mongoose.Schema.Types.ObjectId, required: true })
  stagedBy!: mongoose.Types.ObjectId;

  @MongoField({ type: mongoose.Schema.Types.ObjectId, required: false })
  publishedBy?: mongoose.Types.ObjectId;

  @MongoField({ type: Date, required: false })
  publishedAt?: Date;
}

export const CatalogImportBatchModel = createMongoModel("CatalogImportBatch", CatalogImportBatchSchema);
