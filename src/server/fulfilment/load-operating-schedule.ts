import { operatingHoursRepository } from "../core/repositories";
import type { OperatingSchedule } from "../engines/shipping/shipping.types";

/**
 * The store's opening schedule as the shipping engine reads it. No document
 * yet is a valid state, not an error: the empty schedule it yields means
 * "hours not configured", which the engine treats as open every day.
 *
 * One loader for both callers — the quote and order placement — so the two can
 * never read the schedule differently and promise different dates.
 */
export async function loadOperatingSchedule(): Promise<OperatingSchedule> {
  const hours = await operatingHoursRepository.findOne({ where: {}, skipThrowError: true });
  if (!hours) return { weekly: [], exceptions: [] };
  return {
    weekly: hours.weekly.map((day) => ({ weekday: day.weekday, ranges: day.ranges.map((range) => ({ open: range.open, close: range.close })) })),
    exceptions: hours.exceptions.map((exception) => ({
      date: new Date(exception.date),
      closed: exception.closed,
      ranges: exception.ranges.map((range) => ({ open: range.open, close: range.close })),
    })),
  };
}
