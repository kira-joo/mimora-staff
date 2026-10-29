import { IsString, MaxLength, MinLength } from "class-validator";

export class AcceptStaffInviteDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  token!: string;

  /** Same bounds as `restaurant-platform-staff`'s staff password policy. */
  @IsString()
  @MinLength(10, { message: "password must be at least 10 characters." })
  @MaxLength(200)
  password!: string;
}
