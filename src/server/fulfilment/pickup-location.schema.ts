import { MongoField, MongoSchema, localizedStringField, createMongoModel } from "@kira-joo/backend-toolkit-mongoose";
import type { LocalizedString } from "@kira-joo/toolkit-common";
import mongoose from "mongoose";

/**
 * PickupLocation — a place a customer may collect an order from.
 *
 * Corrective fix: this model did not exist at all in the original v1 of
 * Phase 2. Its absence made pickup unrepresentable anywhere in the schema,
 * even though MDS §8.5 and §16 treat pickup as a first-class, independently
 * switchable fulfilment capability. `Order.fulfilment.pickupLocationSnapshot`
 * copies this location's display fields at placement time — never a
 * `@Relation` — because a location's address may change after an order that
 * referenced it was placed.
 *
 * [ASSUMPTION: `hoursOverride` and named-area coordinates are out of scope for
 * this corrective pass — the full `OperatingHours` entity (weekly ranges plus
 * exceptions) is its own MDS §8.5 entity and a materially larger feature than
 * the pickup on/off switch this correction restores. `coordinates` is
 * optional for the same reason: not every location has geocoding available at
 * creation.]
 */
@MongoSchema({ timestamps: true })
export class PickupLocationSchema {
  _id!: mongoose.Types.ObjectId;

  @MongoField(localizedStringField())
  name!: LocalizedString;

  @MongoField(localizedStringField())
  address!: LocalizedString;

  @MongoField({
    type: new mongoose.Schema(
      {
        lat: { type: Number, required: true },
        lng: { type: Number, required: true },
      },
      { _id: false }
    ),
    required: false,
  })
  coordinates?: { lat: number; lng: number };

  @MongoField({ type: String, required: true })
  phone!: string;

  @MongoField({ type: Boolean, default: true })
  active!: boolean;

  @MongoField({ type: Number, default: 0 })
  order!: number;
}

export const PickupLocationModel = createMongoModel("PickupLocation", PickupLocationSchema);
