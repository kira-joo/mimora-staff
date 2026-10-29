import { IsIn, IsOptional } from "class-validator";
import { BaseFindQueryDto } from "@kira-joo/backend-toolkit-core";

export class ListAdminReturnsQueryDto extends BaseFindQueryDto {
  @IsOptional()
  @IsIn(["REQUESTED", "APPROVED", "RECEIVED", "REJECTED", "REFUNDED"])
  status?: "REQUESTED" | "APPROVED" | "RECEIVED" | "REJECTED" | "REFUNDED";
}
