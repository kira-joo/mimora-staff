import { IsString, MaxLength } from "class-validator";

/** `PUT /api/admin/orders/:id/tracking` — both fields, always: this route exists to set a carrier and number. */
export class UpdateOrderTrackingDto {
  @IsString()
  @MaxLength(32)
  carrierKey!: string;

  @IsString()
  @MaxLength(64)
  trackingNumber!: string;
}
