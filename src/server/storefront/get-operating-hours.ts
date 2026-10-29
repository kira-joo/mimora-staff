import { operatingHoursRepository } from "../core/repositories";
import type { OperatingHoursSchema } from "../fulfilment/operating-hours.schema";

const EMPTY: Pick<OperatingHoursSchema, "weekly" | "exceptions"> = { weekly: [], exceptions: [] };

/**
 * Returns the configured weekly schedule + exceptions, or an empty
 * schedule if none is configured yet — a store with no operating hours
 * set is a valid (if incomplete) configuration state, not a 404. The
 * storefront treats an empty `weekly[]` as "hours not yet published,"
 * which is a real, renderable state, not an error.
 */
export async function getOperatingHours(): Promise<Pick<OperatingHoursSchema, "weekly" | "exceptions">> {
  const hours = await operatingHoursRepository.findOne({ where: {}, skipThrowError: true });
  if (!hours) return EMPTY;
  return { weekly: hours.weekly, exceptions: hours.exceptions };
}
