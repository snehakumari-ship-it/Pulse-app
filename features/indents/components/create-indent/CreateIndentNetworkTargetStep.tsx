/**
 * Create Load — supplier target.
 * Phone: full-page keypad (client-sale compact).
 * Desktop: sale-value card + Edit modal keypad (client-sale desktop).
 */
import { memo, useCallback, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { WizardNumericKeypadFlow } from "@/components/full-page-wizard/WizardNumericKeypadFlow";
import type { NumericEntryPartyPreview } from "@/components/mobile-input/NumericEntryPartyBanner";
import {
  parseRawToNumber,
  toRawString,
} from "@/components/mobile-input/keypad";
import Theme from "@/constants/Theme";
import { DesktopSectionHeading } from "@/features/trips/components/add-trip/CreateTripDesktopUi";
import { PartnerRateSaleMarginStrip } from "@/features/trips/components/add-trip/PartnerRateSaleMarginStrip";
import { createTripDesktopStyles as s } from "@/features/trips/components/add-trip/createTripDesktop.styles";

import { RouteExtraStopsCommercials } from "@/features/trips/components/RouteExtraStopsCommercials";
import type { RouteExtraStopSummary } from "@/features/trips/utils/routeExtraStops.util";

import { IndentTargetDesktopModal } from "./IndentTargetDesktopModal";

const MARGIN_PRESETS = [5, 10, 15, 20] as const;

function fieldToRaw(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const n = parseRawToNumber(trimmed.replace(/[^\d.]/g, ""));
  if (!Number.isFinite(n) || n < 0) return "";
  return toRawString(n);
}

function parseAmount(raw: string): number | null {
  // `Number("")` is 0, not NaN — without this an empty field reads as a real
  // zero and callers treat "nothing entered" as an amount.
  const digits = String(raw).replace(/[^\d.]/g, "");
  if (!digits) return null;
  const n = Number(digits);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function formatInr(raw: string): string | null {
  const n = Number(String(raw).replace(/[^\d.]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  return `₹${n.toLocaleString("en-IN")}`;
}

/** Supplier target for a margin % of client sale (rounded to nearest rupee). */
export function supplierTargetForMarginPct(
  clientPrice: string,
  marginPct: number,
): string | null {
  const sale = parseAmount(clientPrice);
  if (sale == null || sale <= 0) return null;
  const target = Math.round(sale * (1 - marginPct / 100));
  if (target < 0) return null;
  return toRawString(target);
}

function activeMarginPct(
  clientPrice: string,
  supplierTarget: string,
): number | null {
  const sale = parseAmount(clientPrice);
  const target = parseAmount(supplierTarget);
  if (sale == null || sale <= 0 || target == null) return null;
  for (const pct of MARGIN_PRESETS) {
    const expected = supplierTargetForMarginPct(clientPrice, pct);
    if (expected != null && Math.abs(Number(expected) - target) < 0.5) {
      return pct;
    }
  }
  return null;
}

/** How a supplier target is quoted. Mirrors `indents.supplier_rate_basis`. */
export type SupplierRateBasis = "per_mt" | "per_trip";

const BASIS_CHOICES: { value: SupplierRateBasis; label: string }[] = [
  { value: "per_trip", label: "Per trip" },
  { value: "per_mt", label: "Per MT" },
];

export type CreateIndentNetworkTargetStepProps = {
  supplierTarget: string;
  onSupplierTargetChange: (value: string) => void;
  clientPrice?: string;
  /** "per_mt" means `supplierTarget` is a ₹/MT rate, not a trip total. */
  supplierRateBasis?: SupplierRateBasis | null;
  /** Load weight in tons — the multiplier for per-MT entry. */
  weightTons?: string | null;
  /** Client sale as ₹/MT. Lets per-MT margins work without a tonnage. */
  clientUnitRatePerMt?: string | null;
  /** Omit to hide the basis toggle (callers that set the basis elsewhere). */
  onSupplierRateBasisChange?: (value: SupplierRateBasis) => void;
  errorMessage?: string;
  compact?: boolean;
  partyPreview?: NumericEntryPartyPreview;
  onPartyPress?: () => void;
  /** Stops in between; shown as base + charges = saved freight. */
  extraStops?: RouteExtraStopSummary | null;
};

function MarginPresetChips({
  clientPrice,
  supplierTarget,
  onPick,
  disabledReason,
}: {
  clientPrice: string;
  supplierTarget: string;
  onPick: (raw: string) => void;
  /** Why the presets cannot be used, shown in place of silent dead chips. */
  disabledReason?: string;
}) {
  const sale = parseAmount(clientPrice);
  const active = activeMarginPct(clientPrice, supplierTarget);
  const disabled = sale == null || sale <= 0;

  return (
    <View style={styles.presetsWrap}>
      <Text style={styles.presetsLabel}>
        {disabled && disabledReason ? disabledReason : "Margin target"}
      </Text>
      <View style={styles.presetsRow}>
        {MARGIN_PRESETS.map((pct) => {
          const selected = active === pct;
          return (
            <Pressable
              key={pct}
              disabled={disabled}
              onPress={() => {
                const next = supplierTargetForMarginPct(clientPrice, pct);
                if (next != null) onPick(next);
              }}
              style={[
                styles.presetChip,
                selected && styles.presetChipActive,
                disabled && styles.presetChipDisabled,
              ]}
              accessibilityRole="button"
              accessibilityState={{ selected, disabled }}
              accessibilityLabel={`${pct} percent margin`}
            >
              <Text
                style={[
                  styles.presetChipText,
                  selected && styles.presetChipTextActive,
                  disabled && styles.presetChipTextDisabled,
                ]}
              >
                {pct}%
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export const CreateIndentNetworkTargetStep = memo(
  function CreateIndentNetworkTargetStep({
    supplierTarget,
    onSupplierTargetChange,
    clientPrice = "",
    supplierRateBasis,
    weightTons,
    clientUnitRatePerMt,
    onSupplierRateBasisChange,
    errorMessage,
    compact = false,
    partyPreview,
    onPartyPress,
    extraStops = null,
  }: CreateIndentNetworkTargetStepProps) {
    const [targetModalOpen, setTargetModalOpen] = useState(false);
    const [doneAttempted, setDoneAttempted] = useState(false);
    const targetDisplay = formatInr(supplierTarget);
    const raw = fieldToRaw(supplierTarget);

    const handleRawChange = useCallback(
      (nextRaw: string) => {
        setDoneAttempted(false);
        onSupplierTargetChange(nextRaw);
      },
      [onSupplierTargetChange],
    );

    const fields = useMemo(
      () => [
        {
          id: "supplierTarget",
          label: "Supplier target",
          rawValue: raw,
          onRawValueChange: handleRawChange,
          // Inside the keypad the field is being edited right now, so only an
          // actual Done attempt should mark it red — carrying the step-level
          // error straight in reds an untouched field and collides with the
          // margin presets underneath.
          errorMessage:
            doneAttempted && !targetDisplay
              ? "Enter a target greater than 0"
              : undefined,
        },
      ],
      [raw, handleRawChange, doneAttempted, targetDisplay],
    );

    /**
     * On a per-MT indent the target is typed as ₹/MT while the client sale is
     * a trip total, so the two are not comparable until the sale is divided
     * back down to ₹/MT. Without a usable weight there is no divisor, and we
     * leave the comparison off rather than show a margin against mixed units.
     */
    const perMtDivisorTons = useMemo(() => {
      if (supplierRateBasis !== "per_mt") return undefined;
      const tons = parseAmount(weightTons ?? "");
      return tons != null && tons > 0 ? tons : undefined;
    }, [supplierRateBasis, weightTons]);

    /**
     * Client sale expressed in the same unit the target is typed in.
     *
     * A per-MT target is a rate, so it compares against the client's ₹/MT rate
     * — no tonnage needed, which matters because the real loaded weight is not
     * known until after loading. Prefer that unit rate; fall back to dividing
     * a trip total only when a weight happens to be set.
     */
    const clientPriceForCompare = useMemo(() => {
      if (supplierRateBasis === "per_mt") {
        const unit = parseAmount(clientUnitRatePerMt ?? "");
        if (unit != null && unit > 0) return String(unit);
      }
      if (perMtDivisorTons == null) return clientPrice;
      const sale = parseAmount(clientPrice);
      if (sale == null) return clientPrice;
      return String(sale / perMtDivisorTons);
    }, [clientPrice, clientUnitRatePerMt, perMtDivisorTons, supplierRateBasis]);

    const showPerMtUnits = supplierRateBasis === "per_mt";
    const marginStrip = (
      <PartnerRateSaleMarginStrip
        saleValue={showPerMtUnits ? clientPriceForCompare : clientPrice}
        partnerRate={supplierTarget}
        saleLabel="Client"
        rateEmptyHint="Type target"
        unitSuffix={showPerMtUnits ? "/MT" : ""}
      />
    );

    /**
     * The presets need a client sale to take a percentage of. On a per-MT lane
     * that sale only exists once a weight is known, so name the missing input
     * instead of leaving the chips greyed out with no reason.
     */
    const marginDisabledReason = useMemo(() => {
      if (parseAmount(clientPriceForCompare) != null) return undefined;
      if (supplierRateBasis === "per_mt") {
        return "Set the client ₹/MT rate to use margin %";
      }
      return "Set client sale to use margin %";
    }, [clientPriceForCompare, supplierRateBasis]);

    /**
     * A ₹/MT target is not the number a partner quotes against — the trip
     * total is. Spell it out so the two are never confused at entry.
     */
    const perMtTripTotal = useMemo(() => {
      if (supplierRateBasis !== "per_mt") return null;
      const rate = parseAmount(supplierTarget);
      const tons = parseAmount(weightTons ?? "");
      if (rate == null || rate <= 0 || tons == null || tons <= 0) return null;
      return Math.round(rate * tons);
    }, [supplierRateBasis, supplierTarget, weightTons]);

    const extraStopsCard =
      extraStops && extraStops.count > 0 ? (
        <RouteExtraStopsCommercials
          summary={extraStops}
          clientBase={parseAmount(clientPrice) ?? 0}
          supplierBase={parseAmount(supplierTarget)}
          supplierPerMt={supplierRateBasis === "per_mt"}
          style={styles.extraStopsCard}
        />
      ) : null;

    const marginChips = (
      <MarginPresetChips
        clientPrice={clientPriceForCompare}
        supplierTarget={supplierTarget}
        onPick={onSupplierTargetChange}
        disabledReason={marginDisabledReason}
      />
    );

    const keypad = (
      <WizardNumericKeypadFlow
        fields={fields}
        partyPreview={partyPreview}
        onPartyPress={onPartyPress}
        compact
        forceMobileLayout={!compact}
        hint={
          compact
            ? "Required network estimate. Tap a margin % above the keypad to auto-fill."
            : undefined
        }
        accessory={
          compact ? (
            <View style={styles.modalAccessory}>
              {marginStrip}
              {extraStopsCard}
            </View>
          ) : (
            <View style={styles.modalAccessory}>
              {marginStrip}
              {marginChips}
            </View>
          )
        }
        dockAccessory={compact ? marginChips : undefined}
      />
    );

    const handleDone = useCallback(() => {
      if (!targetDisplay) {
        setDoneAttempted(true);
        return;
      }
      setDoneAttempted(false);
      setTargetModalOpen(false);
    }, [targetDisplay]);

    if (compact) {
      return <View style={s.saleMobileKeypadRoot}>{keypad}</View>;
    }

    return (
      <View style={s.stepBody}>
        <View style={s.commodityClientSection}>
          <Text style={s.sectionHeading}>Network target *</Text>
          <Text style={styles.hint}>
            Required estimate for partners to quote against. Use a margin % to
            fill from client sale, or enter a value.
          </Text>
          {onSupplierRateBasisChange ? (
            <View style={styles.basisRow}>
              {BASIS_CHOICES.map((choice) => {
                const selected = (supplierRateBasis ?? "per_trip") === choice.value;
                return (
                  <Pressable
                    key={choice.value}
                    onPress={() => onSupplierRateBasisChange(choice.value)}
                    style={[
                      styles.basisChip,
                      selected && styles.basisChipActive,
                    ]}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    accessibilityLabel={`Quote target ${choice.label}`}
                  >
                    <Text
                      style={[
                        styles.basisChipText,
                        selected && styles.basisChipTextActive,
                      ]}
                    >
                      {choice.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}
          <View style={s.sourceRatesBlock}>
            <DesktopSectionHeading>
              {supplierRateBasis === "per_mt"
                ? "Supplier target (₹/MT)"
                : "Supplier target"}
            </DesktopSectionHeading>
            <Pressable
              style={[
                s.sourceRateSummaryCard,
                Boolean(errorMessage) && s.sourceRateSummaryCardError,
              ]}
              onPress={() => {
                setDoneAttempted(false);
                setTargetModalOpen(true);
              }}
              accessibilityRole="button"
              accessibilityLabel="Edit supplier target"
            >
              <View style={s.sourceRateSummaryCopy}>
                <Text style={s.sourceRateSummaryLabel}>Supplier target</Text>
                {targetDisplay ? (
                  <Text style={s.sourceRateSummaryValue}>
                    {targetDisplay}
                    {supplierRateBasis === "per_mt" ? "/MT" : ""}
                  </Text>
                ) : (
                  <Text style={s.sourceRateSummaryValueMuted}>
                    {supplierRateBasis === "per_mt"
                      ? "Tap to enter ₹/MT rate"
                      : "Tap to enter target"}
                  </Text>
                )}
                {perMtTripTotal != null ? (
                  <Text style={styles.hint}>
                    Partners quote against ₹
                    {perMtTripTotal.toLocaleString("en-IN")} for this load
                  </Text>
                ) : null}
                {errorMessage ? (
                  <Text style={s.salePriceError}>{errorMessage}</Text>
                ) : null}
              </View>
              <View style={s.sourceRateSummaryAction}>
                <Text style={s.sourceRateSummaryActionText}>
                  {targetDisplay ? "Edit" : "Add target"}
                </Text>
              </View>
            </Pressable>
          </View>
          <View style={styles.accessoryStack}>
            {marginStrip}
            {marginChips}
            {extraStopsCard}
          </View>
        </View>

        <IndentTargetDesktopModal
          visible={targetModalOpen}
          onClose={() => {
            setDoneAttempted(false);
            setTargetModalOpen(false);
          }}
          onDone={handleDone}
        >
          {keypad}
        </IndentTargetDesktopModal>
      </View>
    );
  },
);

const styles = StyleSheet.create({
  hint: {
    color: Theme.textSecondary,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "500",
  },
  extraStopsCard: {
    maxWidth: 420,
    alignSelf: "center",
  },
  accessoryStack: {
    width: "100%",
    alignItems: "center",
    gap: 8,
  },
  basisRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 12,
  },
  basisChip: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Theme.borderLight,
    backgroundColor: Theme.surface,
  },
  basisChipActive: {
    borderColor: Theme.accentBrownBorder,
    backgroundColor: Theme.accentBrownMuted,
  },
  basisChipText: {
    fontSize: 14,
    fontWeight: "600",
    color: Theme.textSecondary,
  },
  basisChipTextActive: {
    color: Theme.textPrimary,
  },
  modalAccessory: {
    width: "100%",
    maxWidth: 320,
    alignSelf: "center",
    alignItems: "stretch",
    gap: 8,
  },
  presetsWrap: {
    width: "100%",
    maxWidth: 320,
    alignSelf: "center",
    gap: 4,
  },
  presetsLabel: {
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 0.5,
    textTransform: "uppercase",
    color: Theme.textMuted,
    textAlign: "center",
  },
  presetsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  presetChip: {
    minWidth: 52,
    minHeight: 36,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Theme.borderLight,
    backgroundColor: Theme.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  presetChipActive: {
    backgroundColor: Theme.accentBrownMuted,
    borderColor: Theme.accentBrownBorder,
  },
  presetChipDisabled: {
    opacity: 0.45,
  },
  presetChipText: {
    fontSize: 11,
    fontWeight: "700",
    color: Theme.textMuted,
    letterSpacing: -0.1,
  },
  presetChipTextActive: {
    color: Theme.accentBrownDeep,
  },
  presetChipTextDisabled: {
    color: Theme.textMuted,
  },
});
