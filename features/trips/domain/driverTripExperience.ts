/**
 * Driver App trip-detail experience.
 *
 * Canonical Commerce signal is the Business/Commerce indent origin:
 * `indent.execution_plan_id`, normalized onto the trip as `is_commerce` /
 * `execution_plan_id` (see applyIndentCommerceOrigin / normalizeTripRowWithIndent).
 *
 * Do not infer Commerce from stop counts, order counts, or SES rows.
 * `getTripExecutionModel` is asset vs aggregate fleet economics — not this.
 */
export type DriverTripExperience = 'STANDARD_FTL' | 'COMMERCE_MULTI_ORDER';

export type DriverTripExperienceInput = {
  is_commerce?: boolean;
  execution_plan_id?: string | null;
};

export function getDriverTripExperience(
  trip: DriverTripExperienceInput | null | undefined,
): DriverTripExperience {
  if (!trip) return 'STANDARD_FTL';
  if (trip.is_commerce === true) return 'COMMERCE_MULTI_ORDER';
  if ((trip.execution_plan_id ?? '').trim()) return 'COMMERCE_MULTI_ORDER';
  return 'STANDARD_FTL';
}

export function isCommerceDriverTrip(
  trip: DriverTripExperienceInput | null | undefined,
): boolean {
  return getDriverTripExperience(trip) === 'COMMERCE_MULTI_ORDER';
}

/** Keep Commerce origin when a status write returns a trips-table row without derived flags. */
export function mergeTripRowPreservingCommerceOrigin<
  T extends DriverTripExperienceInput & { indent_id?: string | null; source_indent_id?: string | null },
>(current: T, updated: T): T {
  const executionPlanId =
    (updated.execution_plan_id ?? '').trim() ||
    (current.execution_plan_id ?? '').trim() ||
    null;
  return {
    ...current,
    ...updated,
    indent_id: updated.indent_id ?? current.indent_id,
    source_indent_id: updated.source_indent_id ?? current.source_indent_id,
    execution_plan_id: executionPlanId,
    is_commerce:
      Boolean(updated.is_commerce) ||
      Boolean(current.is_commerce) ||
      Boolean(executionPlanId),
  };
}
