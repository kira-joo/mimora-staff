import { IsIn, IsOptional } from "class-validator";
import { BaseFindQueryDto } from "@kira-joo/backend-toolkit-core";

export class ListNotificationsQueryDto extends BaseFindQueryDto {
  /** `"true"` lists only what the caller has not read yet. */
  @IsOptional()
  @IsIn(["true", "false"])
  unread?: "true" | "false";
}
