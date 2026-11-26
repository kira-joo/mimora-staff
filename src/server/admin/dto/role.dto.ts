import { Trim } from "@kira-joo/backend-toolkit-core";
import { ArrayMaxSize, ArrayUnique, IsArray, IsBoolean, IsString, MaxLength, MinLength, ValidateIf } from "class-validator";

/** Permissions are named by their stable `Entity.action` key, never by a database id. */
export class CreateRoleDto {
  @Trim() @IsString() @MinLength(1, { message: "Enter a role name." }) @MaxLength(60, { message: "Use at most 60 characters." }) name!: string;

  @IsArray() @ArrayMaxSize(500) @ArrayUnique() @IsString({ each: true }) permissionKeys!: string[];

  /** Full access, including permissions added later. Only someone who has it can grant it. */
  @ValidateIf((_, value) => value !== undefined) @IsBoolean() grantsAll?: boolean;

  @ValidateIf((_, value) => value !== undefined) @IsBoolean() isActive?: boolean;
}

/** Every field optional: send only what changed. */
export class UpdateRoleDto {
  @ValidateIf((_, value) => value !== undefined) @Trim() @IsString() @MinLength(1, { message: "Enter a role name." }) @MaxLength(60, { message: "Use at most 60 characters." }) name?: string;

  @ValidateIf((_, value) => value !== undefined) @IsArray() @ArrayMaxSize(500) @ArrayUnique() @IsString({ each: true }) permissionKeys?: string[];

  @ValidateIf((_, value) => value !== undefined) @IsBoolean() grantsAll?: boolean;

  @ValidateIf((_, value) => value !== undefined) @IsBoolean() isActive?: boolean;
}
