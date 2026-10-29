import { Trim } from "@kira-joo/backend-toolkit-core";
import { ArrayMaxSize, IsArray, IsEmail, IsMongoId, IsOptional, IsString, MaxLength, MinLength } from "class-validator";

/**
 * No password field. An invited account is created without one and
 * completed through the reset-token flow (`invite-staff.ts`), so a
 * password is never transmitted to or chosen by whoever creates the
 * account. MDS §2: "Staff accounts are invite-only. No self-signup route
 * exists."
 */
export class InviteStaffDto {
  @Trim() @IsString() @MinLength(1) @MaxLength(120) name!: string;
  @Trim() @IsEmail({}, { message: "Enter a valid email address." }) email!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsMongoId({ each: true })
  roleIds?: string[];
}
