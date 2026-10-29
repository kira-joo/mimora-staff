import { ConfigurationError } from "@kira-joo/backend-toolkit-core";
import { assertTimeZone } from "../../engines/reports/zoned-calendar";

/**
 * The store's own IANA time zone (`STORE_TIMEZONE`, e.g. `Africa/Cairo`) —
 * what "a day" and "a month" mean in reports. Required: there is no default,
 * because a silently assumed zone shifts every daily figure by the offset and
 * looks correct while doing it.
 *
 * Checked at boot (`instrumentation.ts`) so a missing or misspelled zone stops
 * the server rather than surfacing on the first report request.
 */
export function storeTimeZone(): string {
  const value = process.env.STORE_TIMEZONE?.trim();
  if (!value) {
    throw new ConfigurationError("STORE_TIMEZONE must be set to the store's IANA time zone, e.g. Africa/Cairo.");
  }
  try {
    assertTimeZone(value);
  } catch {
    throw new ConfigurationError(`STORE_TIMEZONE "${value}" is not a recognised IANA time zone.`);
  }
  return value;
}
