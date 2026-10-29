import { Type } from "class-transformer";
import { ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsInt, IsNotEmpty, IsString, Max, Min, ValidateNested } from "class-validator";

class HourRangeDto {
  @IsString()
  @IsNotEmpty()
  open!: string;

  @IsString()
  @IsNotEmpty()
  close!: string;
}

class WeeklyHoursDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(6)
  weekday!: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => HourRangeDto)
  ranges!: HourRangeDto[];
}

class HoursExceptionDto {
  @IsDateString()
  date!: string;

  @IsBoolean()
  closed!: boolean;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => HourRangeDto)
  ranges!: HourRangeDto[];
}

export class UpdateOperatingHoursDto {
  @IsArray()
  @ArrayMaxSize(7)
  @ValidateNested({ each: true })
  @Type(() => WeeklyHoursDto)
  weekly!: WeeklyHoursDto[];

  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => HoursExceptionDto)
  exceptions!: HoursExceptionDto[];
}
