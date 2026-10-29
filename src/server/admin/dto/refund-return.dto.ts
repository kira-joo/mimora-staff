import { IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from "class-validator";

const MONEY_STRING_PATTERN = /^\d+(\.\d{1,2})?$/;

export class RefundReturnDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  refundReference!: string;

  /** Defaults to the order's total (a full refund) when omitted. */
  /** Required: a refund records exactly the money that moved, never a default. Must be > 0 and fit the order's refundable remainder. */
  @IsNotEmpty()
  @Matches(MONEY_STRING_PATTERN, { message: "amount must be a non-negative decimal amount, e.g. \"10.00\"." })
  amount!: string;
}
