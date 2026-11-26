import { Trim } from "@kira-joo/backend-toolkit-core";
import { ArrayMaxSize, IsArray, IsBoolean, IsMongoId, IsString, MaxLength, MinLength, ValidateIf } from "class-validator";

/** Role assignment and deactivation both go through this one PUT — MDS §18: "Staff list, invite, role assignment, deactivate." */
export class UpdateStaffDto {
  @ValidateIf((_, value) => value !== undefined) @Trim() @IsString() @MinLength(1) @MaxLength(120) name?: string;

  @ValidateIf((_, value) => value !== undefined) @IsArray() @ArrayMaxSize(20) @IsMongoId({ each: true }) roleIds?: string[];

  /** Deactivating takes effect on the account's very next request, via `resolveStaffUser`. */
  @ValidateIf((_, value) => value !== undefined) @IsBoolean() active?: boolean;
}
