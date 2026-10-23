/**
 * POD Verification settlement summary: the same receivable / payable targets
 * as the trip detail Finance hub (computeTripSettlementDues), broken down into
 * base → CN/DN → revised → paid → final settlement.
 */
import type { LedgerRow } from "@/features/finance/services/finance.service";
import { computeTripSettlementDues } from "@/features/finance/utils/tripSettlement.util";
import { isAdjustmentVoided, type TripAdjustment } from "@/features/trips/services/tripAdjustments";
import type { TripRow } from "@/features/trips/services/trips.service";

export type SettlementLaneBreakdown = {
  base: number;
  /** DN total (raises the lane). */
  debitNotes: number;
  /** CN total (lowers the lane). */
  creditNotes: number;
  /** Base + DN − CN; the Finance hub target. */
  revised: number;
  /** Received from client / paid to supplier so far. */
  settled: number;
  /** Revised − settled. Negative = over-settled (refund / recover). */
  balance: number;
};

export type ComplianceSettlementSummary = {
  receivable: SettlementLaneBreakdown;
  payable: SettlementLaneBreakdown & { advancePaid: number; otherPaid: number };
};

const round2 = (n: number) => Math.round(n * 100) / 100;

function noteTotals(adjustments: readonly TripAdjustment[], type: TripAdjustment["type"]) {
  let debitNotes = 0;
  let creditNotes = 0;
  for (const adj of adjustments) {
    if (adj.type !== type || isAdjustmentVoided(adj)) continue;
    const amount = Math.abs(Number(adj.amount) || 0);
    if (adj.impact === "plus") debitNotes += amount;
    else creditNotes += amount;
  }
  return { debitNotes: round2(debitNotes), creditNotes: round2(creditNotes) };
}

export function complianceSettlementSummary(input: {
  trip: TripRow;
  viewerOrgId: string | null;
  adjustments: readonly TripAdjustment[];
  ledgerEntries: readonly LedgerRow[];
}): ComplianceSettlementSummary {
  const adjustments = [...input.adjustments];
  const dues = computeTripSettlementDues({
    trip: input.trip,
    viewerOrgId: input.viewerOrgId,
    ledgerEntries: [...input.ledgerEntries],
    adjustments,
  });

  const sale = noteTotals(adjustments, "revenue");
  const cost = noteTotals(adjustments, "cost");
  const advancePaid = round2(
    input.ledgerEntries
      .filter((row) => row.ledger_category === "compliance_advance")
      .reduce((sum, row) => sum + (Number(row.amount_out) || 0), 0),
  );
  const payablePaid = round2(dues.payablePaid);

  return {
    receivable: {
      base: round2(dues.receivableTarget - sale.debitNotes + sale.creditNotes),
      ...sale,
      revised: round2(dues.receivableTarget),
      settled: round2(dues.clientReceived),
      balance: round2(dues.receivableTarget - dues.clientReceived),
    },
    payable: {
      base: round2(dues.payableTarget - cost.debitNotes + cost.creditNotes),
      ...cost,
      revised: round2(dues.payableTarget),
      settled: payablePaid,
      advancePaid: Math.min(advancePaid, payablePaid),
      otherPaid: round2(Math.max(0, payablePaid - advancePaid)),
      balance: round2(dues.payableTarget - payablePaid),
    },
  };
}
