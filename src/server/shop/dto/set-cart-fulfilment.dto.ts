/*
 * `@Type()` below is the first use of `class-transformer`'s runtime type
 * reflection anywhere in this repo (every other DTO only uses plain
 * `class-validator` decorators, which never call `Reflect.getMetadata`).
 * Confirmed by running the production build: without this import,
 * `next build`'s page-data collection fails with "Reflect.getMetadata is
 * not a function" — `route-factories.ts`'s own side-effect import of
 * `reflect-metadata` (see `ensure-configured.ts`'s doc comment on why it
 * re-imports it "in the one module every route factory import already
 * goes through") does not reliably reach this DTO's module graph under
 * Turbopack's chunk-splitting. Importing it here directly, first, removes
 * that dependency entirely, the same defensive move `ensure-configured.ts`
 * already makes for the same reason.
 */
import "reflect-metadata";
import { Type } from "class-transformer";
import { IsIn, IsMongoId, ValidateIf, ValidateNested } from "class-validator";
import { CartFulfilmentAddressDto } from "./cart-fulfilment-address.dto";

/**
 * `PUT /api/shop/cart/fulfilment` body. `address` is required exactly when
 * `mode === "DELIVERY"`, `pickupLocationId` exactly when `mode ===
 * "PICKUP"` — enforced here with `@ValidateIf`, not left to the domain
 * function, so a mode/payload mismatch is a 422 before any database call.
 */
export class SetCartFulfilmentDto {
  @IsIn(["DELIVERY", "PICKUP"])
  mode!: "DELIVERY" | "PICKUP";

  @ValidateIf((dto: SetCartFulfilmentDto) => dto.mode === "DELIVERY")
  @ValidateNested()
  @Type(() => CartFulfilmentAddressDto)
  address?: CartFulfilmentAddressDto;

  @ValidateIf((dto: SetCartFulfilmentDto) => dto.mode === "PICKUP")
  @IsMongoId()
  pickupLocationId?: string;
}
