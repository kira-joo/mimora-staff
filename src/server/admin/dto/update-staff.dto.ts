import { Trim } from "@kira-joo/backend-toolkit-core";
import { ArrayMaxSize, IsArray, IsBoolean, IsMongoId, IsOptional, IsString, MaxLength, MinLength } from "class-validator";

/** Role assignment and deactivation both go through this one PUT — MDS §18: "Staff list, invite, role assignment, deactivate." */
export class UpdateStaffDto {
  @IsOptional() @Trim() @IsString() @MinLength(1) @MaxLength(120) name?: string;

  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsMongoId({ each: true }) roleIds?: string[];

  /** Deactivating takes effect on the account's very next request, via `resolveStaffUser`. */
  @IsOptional() @IsBoolean() active?: boolean;
}
