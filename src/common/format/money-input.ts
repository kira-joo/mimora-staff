/**
 * A money amount as staff type it: major units, up to two decimals, no sign,
 * no grouping — the same pattern the API's DTOs enforce. Money stays a
 * string end to end; the client never parses it into a float.
 */
export const MONEY_INPUT_PATTERN = /^\d+(\.\d{1,2})?$/;

export const MONEY_INPUT_MESSAGE = "Enter an amount like 250 or 249.99.";

export const isMoneyInput = (value: string): boolean => MONEY_INPUT_PATTERN.test(value.trim());
