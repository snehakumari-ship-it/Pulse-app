/**
 * Debit control → Mark POD Verified: turns the trip's CN/DN lines into the
 * POD charge lines Settlement Verification reads. DN lines land on an
 * "included" field, CN lines on a "deducted" field, so the totals equal the
 * revised sale / cost after CN/DN.
 */
import {
  EMPTY_CHARGE_LINES,
  type PodChargeLines,
} from "@/features/debit-control/utils/debitControlPod.model";
import { isAdjustmentVoided, type TripAdjustment } from "@/features/trips/services/tripAdjustments";

type ChargeKey = keyof PodChargeLines;

/** DN (plus) reason → included field. Anything else → Other Value. */
const DN_FIELD: Record<string, ChargeKey> = {
  "Loading Charges": "loading",
  "Unloading Charges": "unloading",
  Detention: "halting",
};

/** CN (minus) reason → deducted field. Anything else → Damage Value. */
const CN_FIELD: Record<string, ChargeKey> = {
  "Late Delivery": "delay",
  "Damages / Missing": "damage",
  "POD Delay Submission": "podDelaySubmission",
  "Document Cost": "documentCost",
};

/** Vendor-only deductions; on the client side they fall back to Damage Value. */
const VENDOR_ONLY: ReadonlySet<ChargeKey> = new Set(["podDelaySubmission", "documentCost"]);

function chargeKeyFor(adj: TripAdjustment, side: "client" | "vendor"): ChargeKey {
  const reason = String(adj.reason ?? "").trim();
  if (adj.impact === "plus") return DN_FIELD[reason] ?? "other";
  const key = CN_FIELD[reason] ?? "damage";
  return side === "client" && VENDOR_ONLY.has(key) ? "damage" : key;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function podChargesFromAdjustments(input: {
  clientPrice: number;
  supplierRate: number;
  adjustments: readonly TripAdjustment[];
}): { client: PodChargeLines; vendor: PodChargeLines } {
  const client: PodChargeLines = { ...EMPTY_CHARGE_LINES, cost: round2(Math.max(0, input.clientPrice || 0)) };
  const vendor: PodChargeLines = { ...EMPTY_CHARGE_LINES, cost: round2(Math.max(0, input.supplierRate || 0)) };
  for (const adj of input.adjustments) {
    if (isAdjustmentVoided(adj)) continue;
    const amount = Math.abs(Number(adj.amount) || 0);
    if (amount <= 0) continue;
    const side = adj.type === "revenue" ? "client" : "vendor";
    const lines = side === "client" ? client : vendor;
    const key = chargeKeyFor(adj, side);
    lines[key] = round2(lines[key] + amount);
  }
  return { client, vendor };
}
