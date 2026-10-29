import { IsIn, IsOptional, Matches } from "class-validator";

const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class SalesSummaryQueryDto {
  @IsOptional()
  @IsIn(["day", "month"])
  granularity?: "day" | "month";

  /** Inclusive store-local calendar date, `YYYY-MM-DD`. */
  @IsOptional()
  @Matches(CALENDAR_DATE, { message: "from must be a YYYY-MM-DD date" })
  from?: string;

  /** Inclusive store-local calendar date, `YYYY-MM-DD`. */
  @IsOptional()
  @Matches(CALENDAR_DATE, { message: "to must be a YYYY-MM-DD date" })
  to?: string;
}
