import { Type } from "class-transformer";
import { ArrayMaxSize, IsArray, IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, Min, ValidateNested } from "class-validator";
import { LocalizedStringDto } from "@kira-joo/backend-toolkit-core";

class PaymentDestinationDto {
  @IsOptional()
  @IsString()
  accountName?: string;

  @IsOptional()
  @IsString()
  number?: string;

  @IsOptional()
  @IsString()
  handle?: string;
}

class PaymentMethodDto {
  @IsString()
  @IsNotEmpty()
  method!: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  order?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => LocalizedStringDto)
  instructions?: LocalizedStringDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => PaymentDestinationDto)
  destination?: PaymentDestinationDto;

  @IsOptional()
  @IsBoolean()
  requiresProof?: boolean;

  @IsOptional()
  @IsBoolean()
  requiresProviderIntegration?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  autoCancelMinutes?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  verificationWindowMinutes?: number;
}

export class UpdatePaymentSettingsDto {
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => PaymentMethodDto)
  methods!: PaymentMethodDto[];
}
