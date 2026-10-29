import { IsIn, IsOptional, IsString, MaxLength } from "class-validator";

export class UpdateOrderStatusDto {
  @IsIn(["CONFIRMED", "PROCESSING", "READY_FOR_PICKUP", "SHIPPED", "IN_TRANSIT", "DELIVERED", "COLLECTED", "CANCELLED"])
  status!: "CONFIRMED" | "PROCESSING" | "READY_FOR_PICKUP" | "SHIPPED" | "IN_TRANSIT" | "DELIVERED" | "COLLECTED" | "CANCELLED";

  /** Required by the order-state-machine when `status` is CANCELLED; optional otherwise. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  /**
   * Only with `status: "SHIPPED"`. Optional, but carrier and number are validated TOGETHER
   * (`buildTrackingSnapshot`): one without the other is refused, as is a carrier the store has not configured.
   */
  @IsOptional()
  @IsString()
  @MaxLength(32)
  carrierKey?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  trackingNumber?: string;
}
