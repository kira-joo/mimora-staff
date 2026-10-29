import { IsStorePhone, NormalizePhone } from "src/server/core/phone/store-phone";
import { Trim } from "@kira-joo/backend-toolkit-core";
import { IsEmail, IsOptional, IsString, Length } from "class-validator";

/** Contact details a guest leaves with an order — the only way the store can reach them. */
export class GuestContactDto {
  @IsString()
  @Trim()
  @Length(1, 100)
  name!: string;

  @IsString()
  @Trim()
  @NormalizePhone()
  @IsStorePhone()
  @Length(5, 32)
  phone!: string;

  @IsOptional()
  @IsEmail()
  email?: string;
}
