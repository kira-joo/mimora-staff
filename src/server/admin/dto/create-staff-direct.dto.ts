import { Trim } from "@kira-joo/backend-toolkit-core";
import { ArrayMaxSize, IsArray, IsBoolean, IsEmail, IsMongoId, IsOptional, IsString, MaxLength, MinLength } from "class-validator";
import { STAFF_PASSWORD_MAX, STAFF_PASSWORD_MIN } from "./staff-password-policy";

/**
 * Direct account creation: the administrator sets the first password. The invitation flow (`InviteStaffDto`) stays
 * the alternative for when they should never see it. The password is hashed before it is stored and is redacted from
 * the audit trail (`redact.ts` hides any key with the word "password").
 */
export class CreateStaffDirectDto {
  @Trim() @IsString() @MinLength(1) @MaxLength(120) name!: string;
  @Trim() @IsEmail({}, { message: "Enter a valid email address." }) email!: string;

  @IsString()
  @MinLength(STAFF_PASSWORD_MIN, { message: `password must be at least ${STAFF_PASSWORD_MIN} characters.` })
  @MaxLength(STAFF_PASSWORD_MAX)
  password!: string;

  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsMongoId({ each: true }) roleIds?: string[];

  /** Defaults to true: the person replaces the password before they can do anything else. */
  @IsOptional() @IsBoolean() mustChangePassword?: boolean;
}
