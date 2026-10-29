import { createRefreshTokenSchema, createMongoModel } from "@kira-joo/backend-toolkit-mongoose";

/**
 * Staff refresh tokens — separate collection, no audience discriminator.
 * Built from the Phase 1 factory in backend-toolkit-mongoose.
 */
const StaffRefreshTokenSchema = createRefreshTokenSchema({
  collection: "staff_refresh_tokens",
});

export const StaffRefreshTokenModel = createMongoModel("StaffRefreshToken", StaffRefreshTokenSchema);
