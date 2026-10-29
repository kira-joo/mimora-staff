import { IsOptional, IsString, MaxLength } from "class-validator";

/**
 * DTO for `POST /api/shop/orders/[orderNumber]/cancel` — optional reason.
 *
 * Customer cancellation does not require a reason (unlike admin/staff
 * cancellation which does via order-state-machine.REASON_REQUIRED).
 */
export class CancelOrderDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
