import { MongoField, MongoSchema, Relation, createMongoModel } from "@kira-joo/backend-toolkit-mongoose";
import mongoose from "mongoose";
import { MARKETING_CONSENT_SOURCES, type MarketingConsentSource } from "./customer.schema";

/**
 * One row per CHANGE of a customer's marketing consent — append-only, never
 * updated. `Customer.marketingConsent` holds only the current state, so without
 * this a withdrawal would erase the proof that consent had been given
 * (legal-and-consent.md §2: "proving consent was given … plus a record that it
 * was").
 *
 * **Holds no personal data** — only an opaque `customerId`, so it survives a
 * redaction of the account (the redacted customer is a shell with the same
 * `_id`): the record that consent was given and withdrawn is not something the
 * erasure of the person should destroy, and it identifies nobody once the
 * customer is redacted.
 */
@MongoSchema({ timestamps: false })
export class ConsentEventSchema {
  _id!: mongoose.Types.ObjectId;

  @Relation(() => CustomerRef)
  @MongoField({ type: mongoose.Schema.Types.ObjectId, required: true, ref: "Customer", index: true })
  customerId!: mongoose.Types.ObjectId;

  @MongoField({ type: Boolean, required: true })
  granted!: boolean;

  @MongoField({ type: String, enum: [...MARKETING_CONSENT_SOURCES], required: true })
  source!: MarketingConsentSource;

  @MongoField({ type: Date, required: true })
  at!: Date;
}

class CustomerRef {
  _id!: mongoose.Types.ObjectId;
}

export const ConsentEventModel = createMongoModel("ConsentEvent", ConsentEventSchema);
