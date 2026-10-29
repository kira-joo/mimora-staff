import { Trim } from "@kira-joo/backend-toolkit-core";
import { IsString, MinLength } from "class-validator";

export class LoginDto {
  @IsString()
  @Trim()
  phone!: string;

  @IsString()
  @MinLength(1)
  password!: string;
}
