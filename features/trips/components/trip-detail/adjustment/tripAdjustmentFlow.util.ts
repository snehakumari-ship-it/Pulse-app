import {
  getAdjustmentReasonOptions,
  type TripAdjustmentImpact,
  type TripAdjustmentType,
} from "@/features/trips/services/tripAdjustments";

export type ProvisionProtocolChip = {
  label: string;
  preset: { type: TripAdjustmentType; impact: TripAdjustmentImpact; reasonSeed: string };
};

/** Quick protocol chips for one lane + CN/DN, from the same list as the reason step ("Other" stays manual). */
export function provisionProtocolChips(
  type: TripAdjustmentType,
  impact: TripAdjustmentImpact,
): ProvisionProtocolChip[] {
  return getAdjustmentReasonOptions({ type, impact })
    .filter((reason) => reason !== "Other")
    .map((reason) => ({ label: reason, preset: { type, impact, reasonSeed: reason } }));
}

/** Keep the picked reason only if it is still offered after a lane / CN↔DN switch. */
export function reasonAfterLaneImpactChange(input: {
  type: TripAdjustmentType;
  impact: TripAdjustmentImpact;
  reason: string;
  isAssetDriverCost?: boolean;
}): string {
  const options = getAdjustmentReasonOptions({
    type: input.type,
    impact: input.impact,
    isAssetDriverCost: input.isAssetDriverCost,
  });
  return (options as readonly string[]).includes(input.reason) ? input.reason : "";
}

/** Quick deduct-from-driver chips (asset cost lane, CN / impact minus). */
export const ASSET_DRIVER_DEDUCTION_PROTOCOL_CHIPS = [
  { label: "Damage", reasonSeed: "Damage to cargo" },
  { label: "Missing", reasonSeed: "Missing / shortage" },
  { label: "Late delivery", reasonSeed: "Late delivery" },
  { label: "Advance", reasonSeed: "Advance recovery" },
] as const;

/** Quick pay-driver chips (asset cost lane, DN / impact plus). */
export const ASSET_DRIVER_PAYMENT_PROTOCOL_CHIPS = [
  { label: "Trip tip", reasonSeed: "Trip tip" },
  { label: "Detention", reasonSeed: "Detention allowance" },
  { label: "Loading help", reasonSeed: "Loading / unloading help" },
  { label: "Bonus", reasonSeed: "Performance bonus" },
] as const;

export function protocolAssetDriverDeductionAdjustment(
  chip: (typeof ASSET_DRIVER_DEDUCTION_PROTOCOL_CHIPS)[number],
): {
  type: TripAdjustmentType;
  impact: TripAdjustmentImpact;
  reasonSeed: string;
} {
  return { type: "cost", impact: "minus", reasonSeed: chip.reasonSeed };
}

export function protocolAssetDriverPaymentAdjustment(
  chip: (typeof ASSET_DRIVER_PAYMENT_PROTOCOL_CHIPS)[number],
): {
  type: TripAdjustmentType;
  impact: TripAdjustmentImpact;
  reasonSeed: string;
} {
  return { type: "cost", impact: "plus", reasonSeed: chip.reasonSeed };
}

export type TripAdjustmentWizardStep =
  | "lane"
  | "impact"
  | "protocol"
  | "amount"
  | "reason"
  | "otherReason"
  | "review";

export function buildAdjustmentWizardSteps(opts: {
  laneLocked: boolean;
  impactLocked: boolean;
  reasonLocked: boolean;
  showProtocolShortcuts: boolean;
  /** CN/DN from provision hub: pick reason before amount. */
  reasonBeforeAmount?: boolean;
}): TripAdjustmentWizardStep[] {
  const steps: TripAdjustmentWizardStep[] = [];
  if (!opts.laneLocked) steps.push("lane");
  if (!opts.impactLocked) steps.push("impact");
  if (opts.showProtocolShortcuts) steps.push("protocol");
  if (!opts.reasonLocked && opts.reasonBeforeAmount) {
    steps.push("reason");
  }
  steps.push("amount");
  if (!opts.reasonLocked && !opts.reasonBeforeAmount) {
    steps.push("reason");
  }
  steps.push("review");
  return steps;
}

export function resolveAdjustmentInitialStepIndex(
  steps: TripAdjustmentWizardStep[],
  opts: {
    laneLocked: boolean;
    impactLocked: boolean;
    reasonLocked: boolean;
    reasonBeforeAmount?: boolean;
  },
): number {
  if (opts.reasonLocked) {
    const amountIdx = steps.indexOf("amount");
    return amountIdx >= 0 ? amountIdx : 0;
  }
  if (opts.reasonBeforeAmount) {
    const reasonIdx = steps.indexOf("reason");
    return reasonIdx >= 0 ? reasonIdx : 0;
  }
  if (opts.impactLocked && opts.laneLocked) {
    const amountIdx = steps.indexOf("amount");
    return amountIdx >= 0 ? amountIdx : 0;
  }
  return 0;
}
