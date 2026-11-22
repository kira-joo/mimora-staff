import { IsBoolean, IsOptional, IsString, MaxLength } from "class-validator";
import { ToBoolean } from "@kira-joo/backend-toolkit-core";

/**
 * Checkout's live delivery form. With `delivery=true` the quote prices shipping for the governorate the customer has
 * chosen *now* — before the rest of the address is filled in — instead of a fulfilment saved earlier; with no
 * governorate yet, shipping is pending. Without `delivery`, the quote uses the cart's saved fulfilment as before.
 * A preview only: nothing is saved, and placing the order still uses the full fulfilment the checkout sends.
 */
export class QuoteQueryDto {
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  delivery?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  governorate?: string;
}
