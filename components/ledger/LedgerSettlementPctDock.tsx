/**
 * Quick-settlement % chips (40–90% + full payment) for ledger amount entry.
 */
import { memo, useCallback, useMemo } from "react";
import { Keyboard, Pressable, StyleSheet, Text, View } from "react-native";

import Theme from "@/constants/Theme";
import { LedgerSyncPalette } from "@/constants/LedgerSyncPalette";
import { formatINR, formatLedgerAmountInput } from "@/lib/format";

export const SETTLEMENT_PCTS = [40, 50, 60, 70, 80, 90] as const;
export const FULL_SETTLEMENT_PCT = 100;

/** @deprecated Use formatLedgerAmountInput from @/lib/format */
export function formatLedgerSettlementAmount(amount: number): string {
  return formatLedgerAmountInput(amount);
}

function parseLedgerAmountStr(value: string): number | null {
  const parsed = parseFloat(String(value).replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function resolveActiveSettlementPct(
  dueTotalInr: number,
  amountStr: string,
): number | null {
  const parsed = parseLedgerAmountStr(amountStr);
  if (parsed == null || parsed <= 0 || dueTotalInr <= 0) return null;
  const rounded = Math.round(parsed);
  if (rounded === Math.round(dueTotalInr)) return FULL_SETTLEMENT_PCT;
  for (const pct of SETTLEMENT_PCTS) {
    if (rounded === Math.round((dueTotalInr * pct) / 100)) return pct;
  }
  return null;
}

export type LedgerSettlementPctDockProps = {
  dueTotalInr: number;
  amountStr: string;
  onAmountChange: (value: string) => void;
  accentColor: string;
  /**
   * Light = default cards; dark = legacy ink hero (avoid on new layouts);
   * mint = borderless slate tiles with a sage selection (driver collect payment).
   */
  variant?: "light" | "dark" | "mint";
  /** Tighter tiles for mobile ledger amount step. */
  compact?: boolean;
};

export const LedgerSettlementPctDock = memo(function LedgerSettlementPctDock({
  dueTotalInr,
  amountStr,
  onAmountChange,
  accentColor,
  variant = "light",
  compact = false,
}: LedgerSettlementPctDockProps) {
  const dark = variant === "dark";
  const mint = variant === "mint";
  const activePct = useMemo(
    () => resolveActiveSettlementPct(dueTotalInr, amountStr),
    [dueTotalInr, amountStr],
  );

  const applySettlementPct = useCallback(
    (pct: number) => {
      if (dueTotalInr <= 0) return;
      Keyboard.dismiss();
      const value =
        pct >= FULL_SETTLEMENT_PCT
          ? dueTotalInr
          : Math.round((dueTotalInr * pct) / 100);
      onAmountChange(formatLedgerAmountInput(value));
    },
    [dueTotalInr, onAmountChange],
  );

  if (dueTotalInr <= 0) return null;

  const fullActive = activePct === FULL_SETTLEMENT_PCT;

  return (
    <View
      style={[
        styles.dock,
        compact && styles.dockCompact,
        dark && styles.dockDark,
        mint && styles.dockMint,
      ]}
    >
      <Text
        style={[
          styles.sectionLabel,
          compact && styles.sectionLabelCompact,
          dark && styles.sectionLabelDark,
          mint && styles.labelMint,
        ]}
      >
        Quick settlement
      </Text>
      <Pressable
        style={({ pressed }) => [
          styles.fullPayTile,
          compact && styles.fullPayTileCompact,
          dark && styles.fullPayTileDark,
          mint && styles.tileMint,
          fullActive && !mint && styles.fullPayTileActive,
          fullActive && !mint && { borderColor: accentColor },
          fullActive && dark && { backgroundColor: "rgba(255,255,255,0.08)" },
          fullActive && mint && styles.tileMintActive,
          pressed && styles.tilePressed,
        ]}
        onPress={() => applySettlementPct(FULL_SETTLEMENT_PCT)}
        accessibilityRole="button"
        accessibilityState={{ selected: fullActive }}
        accessibilityLabel={`Full payment, ${formatINR(dueTotalInr)}`}
      >
        <Text
          style={[
            styles.fullPayLabel,
            compact && styles.fullPayLabelCompact,
            dark && styles.fullPayLabelDark,
            mint && styles.inkMint,
            fullActive && { color: accentColor },
          ]}
        >
          Full payment
        </Text>
        <Text
          style={[
            styles.fullPayAmount,
            compact && styles.fullPayAmountCompact,
            { color: mint && !fullActive ? Theme.payInk : accentColor },
          ]}
        >
          {formatINR(dueTotalInr)}
        </Text>
      </Pressable>
      <Text
        style={[
          styles.subsectionLabel,
          compact && styles.subsectionLabelCompact,
          dark && styles.subsectionLabelDark,
          mint && styles.labelMint,
        ]}
      >
        Or choose % of due
      </Text>
      <View style={[styles.pctGrid, compact && styles.pctGridCompact, mint && styles.pctGridMint]}>
        {SETTLEMENT_PCTS.map((pct) => {
          const preview = Math.round((dueTotalInr * pct) / 100);
          const active = activePct === pct;
          return (
            <Pressable
              key={pct}
              style={({ pressed }) => [
                styles.pctTile,
                compact && styles.pctTileCompact,
                dark && styles.pctTileDark,
                mint && styles.tileMint,
                mint && styles.pctTileMint,
                active && !mint && styles.pctTileActive,
                active && !mint && { borderColor: accentColor },
                active && dark && { backgroundColor: "rgba(255,255,255,0.1)" },
                active && mint && styles.tileMintActive,
                pressed && styles.tilePressed,
              ]}
              onPress={() => applySettlementPct(pct)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${pct} percent, ${formatINR(preview)}`}
            >
              <Text
                style={[
                  styles.pctTilePct,
                  compact && styles.pctTilePctCompact,
                  dark && styles.pctTilePctDark,
                  mint && styles.inkMint,
                  mint && styles.pctTilePctMint,
                  active && styles.pctTilePctActive,
                  active && { color: accentColor },
                ]}
              >
                {pct}%
              </Text>
              <Text
                style={[
                  styles.pctTileAmt,
                  compact && styles.pctTileAmtCompact,
                  dark && styles.pctTileAmtDark,
                  mint && styles.pctTileAmtMint,
                  active && styles.pctTileAmtActive,
                  active && !dark && !mint && { color: LedgerSyncPalette.ink },
                  active && dark && { color: Theme.textOnDark },
                  active && mint && { color: accentColor },
                ]}
                numberOfLines={1}
              >
                {formatINR(preview)}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  dock: {
    paddingTop: 12,
    paddingBottom: 4,
    marginTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: LedgerSyncPalette.border,
    width: "100%",
    alignSelf: "stretch",
    minWidth: 0,
    zIndex: 2,
  },
  dockCompact: {
    paddingTop: 8,
    marginTop: 6,
    paddingBottom: 2,
  },
  dockDark: {
    borderTopColor: "rgba(255,255,255,0.12)",
    marginTop: 10,
    paddingTop: 14,
    backgroundColor: "transparent",
  },
  sectionLabel: {
    marginBottom: 8,
    fontSize: 8,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    color: LedgerSyncPalette.muted,
    lineHeight: 10,
    textAlign: "center",
    width: "100%",
  },
  sectionLabelCompact: {
    marginBottom: 6,
    fontSize: 7,
    letterSpacing: 0.6,
  },
  sectionLabelDark: {
    color: LedgerSyncPalette.muted,
    letterSpacing: 0.8,
  },
  subsectionLabel: {
    marginTop: 10,
    marginBottom: 8,
    fontSize: 8,
    fontWeight: "700",
    letterSpacing: 0.4,
    textTransform: "uppercase",
    color: LedgerSyncPalette.muted,
    lineHeight: 10,
    textAlign: "center",
    width: "100%",
  },
  subsectionLabelCompact: {
    marginTop: 6,
    marginBottom: 6,
    fontSize: 7,
  },
  subsectionLabelDark: {
    color: LedgerSyncPalette.muted,
  },
  fullPayTile: {
    width: "100%",
    borderWidth: 1.5,
    borderColor: LedgerSyncPalette.border,
    borderRadius: 12,
    backgroundColor: LedgerSyncPalette.page,
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: "center",
    gap: 2,
    minHeight: 52,
    cursor: "pointer",
  },
  fullPayTileCompact: {
    paddingVertical: 7,
    paddingHorizontal: 10,
    minHeight: 44,
    borderRadius: 10,
  },
  fullPayTileDark: {
    borderColor: "rgba(255,255,255,0.18)",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  fullPayTileActive: {
    backgroundColor: Theme.pulseIndigoWash,
    borderWidth: 2,
  },
  fullPayLabel: {
    fontSize: 10,
    fontWeight: "800",
    color: Theme.textPrimaryDark,
    letterSpacing: 0.2,
    textTransform: "uppercase",
  },
  fullPayLabelCompact: {
    fontSize: 9,
  },
  fullPayLabelDark: {
    color: "rgba(255,255,255,0.72)",
  },
  fullPayAmount: {
    fontSize: 15,
    fontWeight: "900",
    fontVariant: ["tabular-nums"],
    letterSpacing: -0.3,
    lineHeight: 18,
  },
  fullPayAmountCompact: {
    fontSize: 13,
    lineHeight: 16,
  },
  pctGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    width: "100%",
    justifyContent: "space-between",
  },
  pctGridCompact: {
    gap: 6,
  },
  pctTile: {
    width: "31%",
    flexGrow: 1,
    flexShrink: 0,
    borderWidth: 1,
    borderColor: LedgerSyncPalette.border,
    borderRadius: 10,
    backgroundColor: Theme.cardWhite,
    paddingVertical: 8,
    paddingHorizontal: 4,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    minHeight: 50,
    cursor: "pointer",
  },
  pctTileCompact: {
    paddingVertical: 5,
    paddingHorizontal: 2,
    minHeight: 42,
    borderRadius: 8,
  },
  pctTileDark: {
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  pctTileActive: {
    backgroundColor: Theme.pulseIndigoWash,
    borderWidth: 1.5,
  },
  pctTilePct: {
    fontSize: 13,
    fontWeight: "900",
    color: LedgerSyncPalette.ink,
    fontVariant: ["tabular-nums"],
    lineHeight: 16,
  },
  pctTilePctCompact: {
    fontSize: 11,
    lineHeight: 14,
  },
  pctTilePctDark: {
    color: "rgba(255,255,255,0.9)",
  },
  pctTilePctActive: {
    color: Theme.primary,
  },
  pctTileAmt: {
    fontSize: 9,
    fontWeight: "700",
    color: LedgerSyncPalette.muted,
    fontVariant: ["tabular-nums"],
    lineHeight: 12,
    textAlign: "center",
  },
  pctTileAmtCompact: {
    fontSize: 8,
    lineHeight: 11,
  },
  pctTileAmtDark: {
    color: "rgba(255,255,255,0.55)",
  },
  pctTileAmtActive: {
    fontWeight: "800",
  },
  tilePressed: {
    opacity: 0.88,
  },
  dockMint: {
    borderTopWidth: 0,
    marginTop: 12,
    paddingTop: 0,
    paddingBottom: 0,
  },
  labelMint: {
    fontSize: 9,
    letterSpacing: 0.8,
    color: Theme.payMuted,
    lineHeight: 12,
  },
  inkMint: {
    color: Theme.payInk,
  },
  tileMint: {
    borderWidth: 1,
    borderColor: "transparent",
    borderRadius: 12,
    backgroundColor: Theme.payTile,
  },
  tileMintActive: {
    backgroundColor: Theme.paySage,
    borderColor: Theme.driverMintHeaderInk,
  },
  pctGridMint: {
    gap: 8,
  },
  pctTileMint: {
    width: "30%",
    paddingVertical: 10,
    minHeight: 50,
  },
  pctTilePctMint: {
    fontSize: 14,
    lineHeight: 17,
  },
  pctTileAmtMint: {
    marginTop: 1,
    fontSize: 10,
    lineHeight: 13,
    fontWeight: "600",
    color: Theme.payMuted,
  },
});
