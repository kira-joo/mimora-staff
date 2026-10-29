import { IsDateString, IsIn, IsMongoId, IsOptional, IsString, MaxLength } from "class-validator";
import { BaseFindQueryDto } from "@kira-joo/backend-toolkit-core";

export class ListAdminOrdersQueryDto extends BaseFindQueryDto {
  @IsOptional()
  @IsIn(["PLACED", "CONFIRMED", "PROCESSING", "READY_FOR_PICKUP", "SHIPPED", "IN_TRANSIT", "DELIVERED", "COLLECTED", "CANCELLED"])
  status?: "PLACED" | "CONFIRMED" | "PROCESSING" | "READY_FOR_PICKUP" | "SHIPPED" | "IN_TRANSIT" | "DELIVERED" | "COLLECTED" | "CANCELLED";

  @IsOptional()
  @IsIn(["NOT_REQUIRED", "AWAITING_PAYMENT", "SUBMITTED", "VERIFIED", "REJECTED", "REFUNDED"])
  paymentStatus?: "NOT_REQUIRED" | "AWAITING_PAYMENT" | "SUBMITTED" | "VERIFIED" | "REJECTED" | "REFUNDED";

  @IsOptional()
  @IsIn(["DELIVERY", "PICKUP"])
  mode?: "DELIVERY" | "PICKUP";

  @IsOptional()
  @IsMongoId()
  customerId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  zone?: string;

  @IsOptional()
  @IsDateString()
  placedFrom?: string;

  @IsOptional()
  @IsDateString()
  placedTo?: string;
}
