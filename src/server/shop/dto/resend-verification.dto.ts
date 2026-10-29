import { IsEmail } from "class-validator";

/** Email only — this batch's `verify-email`/`resend-verification` cover email verification specifically (no `verify-phone` route was requested; phone OTP is a future-phase concern). */
export class ResendVerificationDto {
  @IsEmail()
  email!: string;
}
