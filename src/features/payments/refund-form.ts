import { MONEY_INPUT_PATTERN } from "src/common/format/money-input";

/**
 * Field errors for the payment-refund dialog. Input shape only — whether the amount fits the order's refundable
 * remainder is the server's call (409). The reference is mandatory (D-12): a refund is recorded, never executed, so
 * the human-supplied transfer or receipt number is the only proof the money moved.
 */
export function refundFormErrors({ amount, reference }: { amount: string; reference: string }): { amount?: string; reference?: string } {
  const value = amount.trim();
  return {
    amount: MONEY_INPUT_PATTERN.test(value) && Number(value) > 0 ? undefined : "Enter the amount returned, e.g. 250.00.",
    reference: reference.trim() ? undefined : "A reference is required — the transfer or receipt number proving the money moved.",
  };
}
