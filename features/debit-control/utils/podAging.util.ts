/** Days after delivery with no POD penalty. Day 16 is the first charged day. */
export const POD_RECEIVING_FREE_DAYS = 15;
/** Rupees charged for each day after the free window. */
export const POD_AGING_PENALTY_PER_DAY = 50;

export type PodReceivingAging = {
  days: number;
  penalty: number;
};

function calendarDay(value: string): number | null {
  const day = value.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const [year, month, date] = day.split("-").map(Number);
  return Date.UTC(year, month - 1, date);
}

/** Days from delivery to dispatch. Null until both dates are set. */
export function podReceivingAging(
  deliveryDate: string | null | undefined,
  dispatchDate: string | null | undefined,
): PodReceivingAging | null {
  const delivery = calendarDay(String(deliveryDate ?? ""));
  const dispatch = calendarDay(String(dispatchDate ?? ""));
  if (delivery == null || dispatch == null) return null;
  const days = Math.round((dispatch - delivery) / 86_400_000);
  const lateDays = Math.max(0, days - POD_RECEIVING_FREE_DAYS);
  return { days, penalty: lateDays * POD_AGING_PENALTY_PER_DAY };
}

/**
 * Aging shown against the 15-day window.
 * Same day is -15, day 15 is 0 (no penalty), day 16 is 1 and the charge starts.
 */
export function podAgingOffset(days: number): number {
  return days - POD_RECEIVING_FREE_DAYS;
}

/** Amount that Vendor POD Delay Submission should show. Empty inside the free window. */
export function podDelaySubmissionAmount(penalty: number | null | undefined): string {
  const amount = Number(penalty) || 0;
  return amount > 0 ? String(amount) : "";
}

/** `-15 days` through `0 days`, then `1 day - ₹50` once the penalty starts. */
export function formatPodReceivingAging(aging: PodReceivingAging | null): string {
  if (!aging) return "—";
  const offset = podAgingOffset(aging.days);
  const unit = Math.abs(offset) === 1 ? "day" : "days";
  const dayLabel = `${offset} ${unit}`;
  if (aging.penalty <= 0) return dayLabel;
  const amount = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(aging.penalty);
  return `${dayLabel} - ${amount}`;
}
