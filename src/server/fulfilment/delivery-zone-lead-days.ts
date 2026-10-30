import type { FieldProblem } from "./carrier-tracking";

/**
 * A zone's delivery estimate is a range: `leadDaysMin` (earliest, optional) to `leadDays` (latest). The earliest
 * may never exceed the latest. Checked against the EFFECTIVE values — what the zone will hold after the write —
 * because a partial update can change either bound alone, so the request body by itself cannot be trusted to show
 * both (`PUT /api/admin/delivery-zones/[id]` passes the stored value for whichever bound the body omits).
 */
export function leadDaysRangeProblems(leadDaysMin: number | null | undefined, leadDays: number): FieldProblem[] {
  if (leadDaysMin === null || leadDaysMin === undefined || leadDaysMin <= leadDays) return [];
  return [{ field: "leadDaysMin", messages: [`The earliest delivery (${leadDaysMin} days) cannot be later than the latest (${leadDays} days).`] }];
}
