import "reflect-metadata";
import { Type } from "class-transformer";
import { Trim } from "@kira-joo/backend-toolkit-core";
import { IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min, ValidateNested } from "class-validator";
import { GuestContactDto } from "./guest-contact.dto";

export const ORDER_NOTES_MAX_LENGTH = 500;

/**
 * DTO for `POST /api/shop/orders` — customer or guest order placement.
 *
 * `idempotencyKey` is NOT a body field — it is the client-supplied
 * `Idempotency-Key` HTTP header, read by `claimIdempotentMutation()`
 * (`core/idempotency/scoped-idempotency.ts`), matching every other mutation
 * route in this app.
 *
 * `paymentMethod` is a plain, open string (per D-6) — `Order.payment.method`
 * is validated against `PaymentSettings.methods[].method` at the route layer
 * once that phase exists, not a fixed union here.
 */
export class PlaceOrderDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  paymentMethod!: string;

  /**
   * D-13: the version of the `terms` page the customer was shown and
   * accepted (`Page.version`, as served by `GET /api/storefront/pages/terms`).
   * The client sends the version it displayed; the server refuses it if the
   * terms have changed since, rather than recording acceptance of text the
   * customer never saw.
   */
  @IsInt()
  @Min(1)
  termsVersionAccepted!: number;

  /**
   * A note from the customer for the order ("leave with the neighbour"). Trimmed, then at most
   * `ORDER_NOTES_MAX_LENGTH`; blank after trimming is treated as no note. Stored on `Order.notes` and shown to
   * staff verbatim — plain text, never rendered as markup.
   */
  @IsOptional()
  @IsString()
  @Trim()
  @MaxLength(ORDER_NOTES_MAX_LENGTH)
  notes?: string;

  /**
   * Required for a guest, forbidden for a signed-in customer — enforced in the
   * route, where the actor is known (a DTO cannot see who is asking). A
   * customer must never be able to place an order "as" someone else.
   */
  @IsOptional()
  @ValidateNested()
  @Type(() => GuestContactDto)
  guestContact?: GuestContactDto;
}
