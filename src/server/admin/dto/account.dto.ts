import { Trim } from "@kira-joo/backend-toolkit-core";
import { IsString, MaxLength, MinLength } from "class-validator";
import { STAFF_PASSWORD_MAX, STAFF_PASSWORD_MIN } from "./staff-password-policy";

/** The fields a staff member may change about themselves. Email and roles are an administrator's to change. */
export class UpdateOwnAccountDto {
  @Trim() @IsString() @MinLength(1, { message: "Enter your name." }) @MaxLength(120, { message: "Use at most 120 characters." }) name!: string;
}

export class ChangeOwnPasswordDto {
  @IsString() @MinLength(1, { message: "Enter your current password." }) @MaxLength(STAFF_PASSWORD_MAX) currentPassword!: string;

  @IsString()
  @MinLength(STAFF_PASSWORD_MIN, { message: `newPassword must be at least ${STAFF_PASSWORD_MIN} characters.` })
  @MaxLength(STAFF_PASSWORD_MAX)
  newPassword!: string;
}
