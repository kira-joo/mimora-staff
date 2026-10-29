import { Trim } from "@kira-joo/backend-toolkit-core";
import { IsString, MinLength } from "class-validator";

export class ApplyCartPromotionDto {
  @IsString()
  @Trim()
  @MinLength(1)
  code!: string;
}
