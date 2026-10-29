import { Trim } from "@kira-joo/backend-toolkit-core";
import { IsInt, IsMongoId, IsOptional, IsString, Min } from "class-validator";

export class AddCartLineDto {
  @IsMongoId()
  variantId!: string;

  @IsInt()
  @Min(1)
  quantity!: number;

  @IsOptional()
  @IsString()
  @Trim()
  note?: string;
}
