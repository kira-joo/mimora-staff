import { IsNotEmpty, IsString, Matches, MaxLength } from "class-validator";
import { MONEY_INPUT_PATTERN } from "../../../common/format/money-input";

// The one money pattern (bounded to what a BSON Double stores exactly) — see money-input.ts.
const MONEY_STRING_PATTERN = MONEY_INPUT_PATTERN;

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
