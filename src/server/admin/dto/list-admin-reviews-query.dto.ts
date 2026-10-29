import { IsIn, IsMongoId, IsOptional } from "class-validator";
import { BaseFindQueryDto } from "@kira-joo/backend-toolkit-core";

export class ListAdminReviewsQueryDto extends BaseFindQueryDto {
  @IsOptional()
  @IsIn(["PENDING", "APPROVED", "REJECTED"])
  status?: "PENDING" | "APPROVED" | "REJECTED";

  @IsOptional()
  @IsMongoId()
  productId?: string;
}
