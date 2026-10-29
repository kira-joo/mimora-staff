import { Trim } from "@kira-joo/backend-toolkit-core";
import { IsString, MinLength } from "class-validator";

/** Identifier is a plain string, accepting either the phone or the email the customer recalls — D-9: both are valid login identifiers. */
export class ForgotPasswordDto {
  @IsString()
  @Trim()
  @MinLength(1)
  identifier!: string;
}
