import {
  MongoField,
  MongoSchema,
  Relation,
  createMongoModel,
} from "@kira-joo/backend-toolkit-mongoose";
import mongoose from "mongoose";

/**
 * Customer address for shipping/billing.
 */
@MongoSchema({ timestamps: true })
export class AddressSchema {
  _id!: mongoose.Types.ObjectId;

  @Relation(() => CustomerSchema)
  @MongoField({ type: mongoose.Schema.Types.ObjectId, required: true, ref: "Customer" })
  customerId!: mongoose.Types.ObjectId;

  @MongoField({ type: String, required: true, trim: true })
  label!: string;

  @MongoField({ type: String, required: true, trim: true })
  recipientName!: string;

  @MongoField({ type: String, required: true, trim: true })
  phone!: string;

  @MongoField({ type: String, required: true, trim: true })
  addressLine1!: string;

  @MongoField({ type: String, required: false, trim: true })
  addressLine2?: string;

  @MongoField({ type: String, required: true, trim: true })
  city!: string;

  @MongoField({ type: String, required: true, trim: true })
  governorate!: string;

  @MongoField({ type: String, required: false, trim: true })
  postalCode?: string;

  @MongoField({ type: Boolean, default: false })
  isDefault!: boolean;
}

// Forward declaration
class CustomerSchema {
  _id!: mongoose.Types.ObjectId;
}

export const AddressModel = createMongoModel("Address", AddressSchema);
