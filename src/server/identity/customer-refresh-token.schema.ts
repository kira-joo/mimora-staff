import { createRefreshTokenSchema, createMongoModel } from "@kira-joo/backend-toolkit-mongoose";

/**
 * Customer refresh tokens — separate collection from staff, no audience discriminator.
 * Built from the Phase 1 factory in backend-toolkit-mongoose.
 */
const CustomerRefreshTokenSchema = createRefreshTokenSchema({
  collection: "customer_refresh_tokens",
});

export const CustomerRefreshTokenModel = createMongoModel("CustomerRefreshToken", CustomerRefreshTokenSchema);
