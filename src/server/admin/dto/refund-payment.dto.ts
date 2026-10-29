import { Trim } from "@kira-joo/backend-toolkit-core";
import { IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from "class-validator";

/** Matches a non-negative decimal amount with up to 2 fraction digits — same shape `toMoney()` accepts as a string. Precedent: `ListStorefrontProductsQueryDto`. */
const MONEY_STRING_PATTERN = /^\d+(\.\d{1,2})?$/;

export class RefundPaymentDto {
  /** Required: a refund records exactly the money that moved, never a default. Must be > 0 and fit the order's refundable remainder. */
  @IsNotEmpty()
  @Matches(MONEY_STRING_PATTERN, { message: "amount must be a non-negative decimal amount, e.g. \"10.00\"." })
  amount!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  /** D-12: refunds are record-and-audit only, so the human-supplied transfer reference is mandatory — proof the money actually moved. */
  @Trim()
  @IsString()
  @IsNotEmpty({ message: "reference is required — the transfer or receipt number proving the money moved." })
  @MaxLength(200)
  reference!: string;
}
