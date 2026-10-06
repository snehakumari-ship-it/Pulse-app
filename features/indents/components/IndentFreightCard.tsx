import { memo } from "react";
import { createStyles, text, view } from "@/lib/styles/createStyles";
import { StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import FontAwesome from "@expo/vector-icons/FontAwesome";

import Theme from "@/constants/Theme";
import { IndentFreightClientEntity } from "@/features/indents/components/IndentFreightClientEntity";
import { indentReviewHubText } from "@/features/indents/styles/indentReviewHubStyles";
import { formatINR } from "@/lib/format";

export type IndentFreightCardClientProps = {
  displayName: string;
  avatarName: string;
  clientId?: string | null;
  ownerOrgId: string | null;
  shipperOrgId: string | null | undefined;
  isOwner: boolean;
  /** Network pool detail: render a neutral stand-in, never the party. */
  anonymous?: boolean;
};

export type IndentFreightCardProps = {
  variant: "owner" | "supplier";
  /** Primary amount line (client freight or target rate). */
  primaryAmount: string;
  supplierRate?: string;
  marginPct?: number | null;
  client: IndentFreightCardClientProps;
  quoteStatus?: string | null;
  quoteAmountInr?: number | null;
};

function stripCurrencyPrefix(formatted: string): string {
  return formatted.replace(/^[^\d,.-]+/, "").trim() || formatted;
}

export const IndentFreightCard = memo(function IndentFreightCard({
  variant,
  primaryAmount,
  supplierRate = "—",
  marginPct = null,
  client,
  quoteStatus,
  quoteAmountInr,
}: IndentFreightCardProps) {
  const isOwner = variant === "owner";
  const primaryLabel = isOwner ? "EST. MARKET FREIGHT" : "TARGET RATE";
  const amountDisplay = stripCurrencyPrefix(primaryAmount);

  return (
    <LinearGradient
      colors={[Theme.darkSurface, Theme.darkBackground]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.card}
    >
      <View style={styles.glow} pointerEvents="none" />
      <View style={styles.content}>
        <View style={styles.heroRow}>
          <View style={styles.heroText}>
            <Text style={styles.heroLabel}>{primaryLabel}</Text>
            <View style={styles.heroAmountRow}>
              <Text style={styles.heroCurrency}>₹</Text>
              <Text style={styles.heroAmount}>{amountDisplay}</Text>
            </View>
          </View>
          <View style={styles.chartIcon}>
            <FontAwesome name="line-chart" size={18} color={Theme.positive} />
          </View>
        </View>

        <View style={styles.perforation} pointerEvents="none">
          <View style={styles.notchLeft} />
          <View style={styles.dashLine} />
          <View style={styles.notchRight} />
        </View>

        {isOwner ? (
          <View style={styles.metricsRow}>
            <View style={styles.metricCell}>
              <Text style={styles.metricLabel}>SUPPLIER RATE</Text>
              <Text style={styles.metricValue}>{supplierRate}</Text>
              {marginPct != null ? (
                <View style={styles.marginChip}>
                  <Text style={styles.marginChipText}>{marginPct}% margin</Text>
                </View>
              ) : null}
            </View>
            <View style={styles.metricDivider} />
            <View style={[styles.metricCell, styles.metricCellClient]}>
              <IndentFreightClientEntity
                label="CLIENT ENTITY"
                displayName={client.displayName}
                avatarName={client.avatarName}
                clientId={client.clientId}
                ownerOrgId={client.ownerOrgId}
                shipperOrgId={client.shipperOrgId}
                isOwner={client.isOwner}
                anonymous={client.anonymous}
                align="left"
                nameLines={2}
                surface="dark"
              />
            </View>
          </View>
        ) : (
          <View style={styles.supplierStack}>
            <View style={styles.shipperPanel}>
              <Text style={styles.metricLabel}>SHIPPER</Text>
              <IndentFreightClientEntity
                displayName={client.displayName}
                avatarName={client.avatarName}
                clientId={client.clientId}
                ownerOrgId={client.ownerOrgId}
                shipperOrgId={client.shipperOrgId}
                isOwner={client.isOwner}
                anonymous={client.anonymous}
                align="left"
                nameLines={2}
                surface="dark"
                hideLabel
              />
            </View>
            {quoteStatus ? (
              <View style={styles.quotePanel}>
                <Text style={styles.metricLabel}>YOUR QUOTE</Text>
                <Text style={styles.quoteValue} numberOfLines={2}>
                  {(quoteStatus || "pending").toUpperCase()}
                  {quoteAmountInr != null
                    ? ` · ${formatINR(quoteAmountInr)}`
                    : ""}
                </Text>
              </View>
            ) : null}
          </View>
        )}
      </View>
    </LinearGradient>
  );
});

const NOTCH = 10;

const stylesDef = {
  card: view({
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    overflow: "hidden",
    shadowColor: Theme.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  }),
  glow: view({
    position: "absolute",
    top: -36,
    right: -36,
    width: 108,
    height: 108,
    borderRadius: 54,
    backgroundColor: Theme.driverWhiteMuted,
  }),
  content: view({
    zIndex: 1,
    gap: 10,
  }),
  heroRow: view({
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  }),
  heroText: view({
    flex: 1,
    minWidth: 0,
    gap: 4,
  }),
  heroLabel: text(indentReviewHubText.freightLabelDark),
  heroAmountRow: view({
    flexDirection: "row",
    alignItems: "baseline",
    gap: 4,
  }),
  heroCurrency: text(indentReviewHubText.freightCurrency),
  heroAmount: text({
    ...indentReviewHubText.freightAmount,
    fontVariant: ["tabular-nums"],
  }),
  chartIcon: view({
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: Theme.positiveMutedDark,
    borderWidth: 1,
    borderColor: Theme.positiveMutedDarkBorder,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  }),
  perforation: view({
    flexDirection: "row",
    alignItems: "center",
    height: NOTCH,
    marginVertical: -2,
  }),
  notchLeft: view({
    width: NOTCH,
    height: NOTCH,
    borderRadius: NOTCH / 2,
    backgroundColor: Theme.screenBackground,
    marginLeft: -14 - NOTCH / 2,
  }),
  notchRight: view({
    width: NOTCH,
    height: NOTCH,
    borderRadius: NOTCH / 2,
    backgroundColor: Theme.screenBackground,
    marginRight: -14 - NOTCH / 2,
  }),
  dashLine: view({
    flex: 1,
    height: StyleSheet.hairlineWidth,
    borderStyle: "dashed",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Theme.separatorDark,
    opacity: 0.85,
  }),
  metricsRow: view({
    flexDirection: "row",
    alignItems: "stretch",
    gap: 0,
  }),
  metricCell: view({
    flex: 1,
    minWidth: 0,
    gap: 6,
  }),
  metricCellClient: view({
    paddingLeft: 2,
  }),
  metricDivider: view({
    width: StyleSheet.hairlineWidth,
    backgroundColor: Theme.separatorDark,
    marginHorizontal: 10,
    alignSelf: "stretch",
    opacity: 0.9,
  }),
  metricLabel: text(indentReviewHubText.freightGridLabelDark),
  metricValue: text({
    ...indentReviewHubText.freightGridValueDark,
    fontSize: 11,
    lineHeight: 15,
  }),
  marginChip: view({
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: "rgba(21,128,61,0.18)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(21,128,61,0.35)",
  }),
  marginChipText: text({
    fontSize: 8,
    fontWeight: "700",
    color: Theme.positive,
    letterSpacing: 0.3,
  }),
  supplierStack: view({
    gap: 10,
  }),
  shipperPanel: view({
    gap: 6,
  }),
  quotePanel: view({
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Theme.separatorDark,
    gap: 4,
  }),
  quoteValue: text({
    ...indentReviewHubText.freightGridValueDark,
    fontSize: 10,
    lineHeight: 14,
  }),
};

const styles = createStyles(stylesDef);
