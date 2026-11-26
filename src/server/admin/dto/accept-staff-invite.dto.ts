import { IsString, MaxLength, MinLength } from "class-validator";
import { STAFF_PASSWORD_MAX, STAFF_PASSWORD_MIN } from "./staff-password-policy";

export class AcceptStaffInviteDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  token!: string;

  /** Same bounds as `restaurant-platform-staff`'s staff password policy. */
  @IsString()
  @MinLength(STAFF_PASSWORD_MIN, { message: `password must be at least ${STAFF_PASSWORD_MIN} characters.` })
  @MaxLength(STAFF_PASSWORD_MAX)
  password!: string;
}
