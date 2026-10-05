import { ComplianceSegmentedFilter } from "@/features/tripCompliance/components/ComplianceSegmentedFilter";
import {
  COMPLIANCE_STAGE_TONE,
  type ComplianceVerifiedOutcomeFilter as OutcomeFilter,
} from "@/features/tripCompliance/utils/complianceCardVisual.util";
import React from "react";

const OPTIONS = [
  { id: "all" as const, label: "All", dot: null },
  { id: "verified" as const, label: "Verified", dot: COMPLIANCE_STAGE_TONE.compliance_verified.fg },
  { id: "rejected" as const, label: "Rejected", dot: COMPLIANCE_STAGE_TONE.pending_for_docs.fg },
];

/** Segmented All / Verified / Rejected control above the Verified-stage trip cards. */
export function ComplianceVerifiedOutcomeFilter({
  value,
  counts,
  onChange,
}: {
  value: OutcomeFilter;
  counts: Record<OutcomeFilter, number>;
  onChange: (next: OutcomeFilter) => void;
}) {
  return <ComplianceSegmentedFilter value={value} counts={counts} options={OPTIONS} onChange={onChange} />;
}
