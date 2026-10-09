/**
 * Shared typography + layout for indent detail (GIVE LOAD owner / GET LOAD supplier)
 * and Review Hub modals (Award, Bid). Compact txn-page rhythm, heavier weights.
 */
import { createStyles, text, view } from "@/lib/styles/createStyles";
import { Platform, StyleSheet } from "react-native";

import { FinanceTxnTypography } from "@/constants/FinanceTxnTypography";
import Layout from "@/constants/Layout";
import Theme from "@/constants/Theme";

export const indentReviewHubText = {
  headerId: {
    ...FinanceTxnTypography.partyTitle,
    fontSize: 12,
    fontWeight: "700" as const,
    fontStyle: "normal" as const,
    color: Theme.textOnDark,
    letterSpacing: 0.35,
  },
  headerSubtitle: {
    ...FinanceTxnTypography.fieldLabel,
    fontSize: 9,
    fontWeight: "600" as const,
    letterSpacing: 0.35,
    color: Theme.textOnDarkMuted,
  },
  chipLabel: {
    ...FinanceTxnTypography.chipLabel,
    fontSize: 8,
    fontWeight: "700" as const,
    letterSpacing: 0.35,
  },
  dateLine: {
    ...FinanceTxnTypography.dateLine,
    fontSize: 9,
    fontWeight: "600" as const,
    color: Theme.textMuted,
  },
  fieldLabel: {
    ...FinanceTxnTypography.fieldLabel,
    fontSize: 8,
    fontWeight: "600" as const,
    color: Theme.textMuted,
  },
  specLabel: {
    ...FinanceTxnTypography.fieldLabel,
    fontSize: 8,
    fontWeight: "600" as const,
    color: Theme.textMuted,
  },
  fieldValue: {
    ...FinanceTxnTypography.fieldValue,
    fontSize: 11,
    fontWeight: "600" as const,
    fontStyle: "normal" as const,
    color: Theme.textPrimaryDark,
    lineHeight: 14,
  },
  sectionTitle: {
    ...FinanceTxnTypography.fieldLabel,
    fontSize: 9,
    fontWeight: "700" as const,
    color: Theme.textMutedDemo,
  },
  partyTitle: {
    ...FinanceTxnTypography.partyTitle,
    fontSize: 11,
    fontWeight: "700" as const,
    fontStyle: "normal" as const,
    color: Theme.textPrimaryDark,
  },
  bodyMuted: {
    ...FinanceTxnTypography.routeWhy,
    fontSize: 10,
    fontWeight: "500" as const,
    fontStyle: "normal" as const,
    color: Theme.textMuted,
    lineHeight: 14,
  },
  buttonLabel: {
    ...FinanceTxnTypography.buttonLabel,
    fontSize: 9,
    fontWeight: "700" as const,
    letterSpacing: 0.45,
  },
  freightLabelDark: {
    ...FinanceTxnTypography.fieldLabel,
    fontSize: 8,
    fontWeight: "600" as const,
    letterSpacing: 0.45,
    color: Theme.textOnDarkMuted,
  },
  freightGridLabelDark: {
    ...FinanceTxnTypography.fieldLabel,
    fontSize: 8,
    fontWeight: "600" as const,
    letterSpacing: 0.4,
    color: Theme.textOnDarkMuted,
    marginBottom: 2,
  },
  freightGridValueDark: {
    ...FinanceTxnTypography.fieldValue,
    fontSize: 11,
    fontWeight: "700" as const,
    fontStyle: "normal" as const,
    color: Theme.textOnDark,
    lineHeight: 14,
  },
  /** White hub card / inset panels — never use onDark tokens on light surfaces. */
  freightGridLabelLight: {
    ...FinanceTxnTypography.fieldLabel,
    fontSize: 8,
    fontWeight: "600" as const,
    letterSpacing: 0.4,
    color: Theme.textRouteCard,
    marginBottom: 2,
  },
  freightGridValueLight: {
    ...FinanceTxnTypography.fieldValue,
    fontSize: 11,
    fontWeight: "700" as const,
    fontStyle: "normal" as const,
    color: Theme.textPrimaryDark,
    lineHeight: 14,
  },
  freightCurrency: {
    fontSize: 11,
    fontWeight: "700" as const,
    color: Theme.textOnDark,
    opacity: 0.85,
  },
  freightAmount: {
    fontSize: 15,
    fontWeight: "800" as const,
    color: Theme.textOnDark,
    letterSpacing: -0.25,
    fontVariant: ["tabular-nums"],
  },
  heroKicker: {
    ...FinanceTxnTypography.fieldLabel,
    fontSize: 8,
    fontWeight: "600" as const,
    letterSpacing: 0.7,
    textTransform: "uppercase" as const,
    color: Theme.textOnDarkMuted,
    marginBottom: 6,
  },
  heroRoute: {
    fontSize: 12,
    fontWeight: "700" as const,
    fontStyle: "normal" as const,
    color: Theme.textOnDark,
    textTransform: "uppercase" as const,
    lineHeight: 16,
    letterSpacing: -0.1,
  },
  heroStatLabel: {
    ...FinanceTxnTypography.fieldLabel,
    fontSize: 8,
    fontWeight: "600" as const,
    letterSpacing: 0.55,
    textTransform: "uppercase" as const,
    color: Theme.textOnDarkMuted,
    marginBottom: 2,
  },
  heroStatValue: {
    fontSize: 12,
    fontWeight: "700" as const,
    color: Theme.textOnDark,
    fontVariant: ["tabular-nums"],
    letterSpacing: -0.15,
  },
  modalSubtitle: {
    ...FinanceTxnTypography.fieldLabel,
    fontSize: 10,
    fontWeight: "500" as const,
    letterSpacing: 0.2,
    color: Theme.textSecondary,
    textAlign: "center" as const,
    marginTop: 4,
  },
  quoteRowName: {
    fontSize: 11,
    fontWeight: "600" as const,
    color: Theme.textBody,
  },
  quoteRowAmount: {
    fontSize: 10,
    fontWeight: "700" as const,
    color: Theme.textBody,
    fontVariant: ["tabular-nums"],
  },
  quoteRowStatus: {
    ...FinanceTxnTypography.chipLabel,
    fontSize: 7,
    fontWeight: "700" as const,
    color: Theme.textMutedDemo,
  },
};

export const indentReviewHubLayout = {
  summaryCardRadius: 12,
  summaryCardPadding: 12,
  /** List / hub ticket cards (Load Center, trips hub). */
  hubCardPaddingComfort: 12,
  hubCardPaddingDense: 10,
  freightCardPadding: 10,
  freightCardRadius: 10,
  sectionGap: 10,
  insetGap: 6,
};

/** Shared elevation for white hub / ticket cards (detail, load center, bids). */
export const indentHubCardShadow = Platform.select({
  ios: {
    shadowColor: Theme.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
  },
  android: { elevation: 2 },
  web: { boxShadow: "0 2px 12px rgba(15, 23, 42, 0.08)" },
  default: {},
});

/** Dark hero + meta row (Award / Bid modals). */
const indentReviewHubStylesDef = {
  reviewHubHero: view({
    borderRadius: 14,
    backgroundColor: Theme.textPrimaryDark,
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginBottom: 8,
    overflow: "hidden",
    minWidth: 0,
    alignSelf: "stretch",
  }),
  reviewHubHeroGlow: view({
    position: "absolute",
    top: -40,
    right: -28,
    width: 128,
    height: 128,
    borderRadius: 64,
    backgroundColor: "rgba(255,255,255,0.07)",
  }),
  reviewHubHeroKicker: text({ ...indentReviewHubText.heroKicker }),
  reviewHubHeroRoute: text({ ...indentReviewHubText.heroRoute }),
  reviewHubHeroMeta: view({
    flexDirection: "row",
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Theme.borderOnDark,
    justifyContent: "space-between",
    alignItems: "flex-end",
    gap: 16,
    minWidth: 0,
  }),
  reviewHubHeroMetaCol: view({
    flex: 1,
    minWidth: 0,
  }),
  reviewHubHeroMetaColEnd: view({
    flexShrink: 1,
    minWidth: 0,
    maxWidth: "58%",
    alignItems: "flex-end",
  }),
  reviewHubHeroStatValueEnd: text({
    textAlign: "right",
    alignSelf: "stretch",
  }),
  reviewHubHeroStatLabel: text({ ...indentReviewHubText.heroStatLabel }),
  reviewHubHeroStatValue: text({
    ...indentReviewHubText.heroStatValue,
    fontVariant: ["tabular-nums"],
  }),
  bidHubHero: view({
    borderRadius: indentReviewHubLayout.summaryCardRadius,
    backgroundColor: Theme.textPrimaryDark,
    padding: indentReviewHubLayout.summaryCardPadding,
    marginBottom: 12,
    overflow: "hidden",
    minWidth: 0,
    alignSelf: "stretch",
  }),
  bidHubHeroGlow: view({
    position: "absolute",
    top: -36,
    right: -36,
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: "rgba(255,255,255,0.06)",
  }),
  bidHubHeroKicker: text({ ...indentReviewHubText.heroKicker }),
  bidHubHeroRoute: text({ ...indentReviewHubText.heroRoute }),
  bidHubHeroChips: view({
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 4,
  }),
  bidHubChip: view({
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.1)",
    borderWidth: 1,
    borderColor: Theme.borderOnDark,
  }),
  bidHubChipText: text({
    ...indentReviewHubText.chipLabel,
    color: Theme.textOnDarkMuted,
  }),
  reviewHubModalSubtitle: text({ ...indentReviewHubText.modalSubtitle }),
  summaryCard: view({
    position: "relative",
    backgroundColor: Theme.cardWhite,
    borderWidth: 1,
    borderColor: Theme.borderLight,
    borderRadius: indentReviewHubLayout.summaryCardRadius,
    padding: indentReviewHubLayout.summaryCardPadding,
    marginBottom: 10,
    overflow: "hidden",
  }),
  summaryRoute: view({
    marginBottom: 6,
  }),
  freightCard: view({
    borderRadius: indentReviewHubLayout.freightCardRadius,
    padding: indentReviewHubLayout.freightCardPadding,
    marginBottom: 10,
    overflow: "hidden",
  }),
  /** Load Center list + Review Hub scroll sections */
  hubTicketCard: view({
    backgroundColor: Theme.cardWhite,
    borderRadius: indentReviewHubLayout.summaryCardRadius,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Theme.borderLight,
  }),
  hubTicketBody: view({
    paddingHorizontal: indentReviewHubLayout.hubCardPaddingComfort,
    paddingTop: indentReviewHubLayout.hubCardPaddingComfort,
    paddingBottom: indentReviewHubLayout.hubCardPaddingComfort,
  }),
  hubTicketBodyDense: view({
    paddingHorizontal: indentReviewHubLayout.hubCardPaddingDense,
    paddingTop: indentReviewHubLayout.hubCardPaddingDense,
    paddingBottom: indentReviewHubLayout.hubCardPaddingDense,
  }),
  hubSectionHeader: view({
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: indentReviewHubLayout.sectionGap,
    minWidth: 0,
  }),
  hubEmptyCard: view({
    backgroundColor: Theme.screenBackground,
    borderRadius: indentReviewHubLayout.summaryCardRadius,
    paddingVertical: indentReviewHubLayout.hubCardPaddingComfort,
    paddingHorizontal: indentReviewHubLayout.hubCardPaddingComfort,
    borderWidth: 1,
    borderColor: Theme.borderLight,
    alignSelf: "stretch",
    gap: indentReviewHubLayout.sectionGap,
  }),
  hubEmptyRow: view({
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    width: "100%",
  }),
  hubEmptyCopy: view({
    flex: 1,
    minWidth: 0,
    gap: 2,
  }),
  hubPill: view({
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Theme.borderMedium,
    backgroundColor: Theme.surfaceGray,
  }),
  hubPillText: text({
    ...indentReviewHubText.chipLabel,
    color: Theme.textPrimaryDark,
  }),
  hubStatePill: view({
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: Theme.positiveMuted,
    borderWidth: 1,
    borderColor: Theme.positiveMutedDarkBorder,
  }),
  hubStatePillText: text({
    ...indentReviewHubText.chipLabel,
    color: Theme.positive,
  }),
};

export const indentReviewHubStyles = createStyles(indentReviewHubStylesDef);

/** Review Hub — summary left (primary), bids / quote scroll pane right (secondary). */
export const indentReviewHubSplitLayout = StyleSheet.create({
  splitRow: {
    flex: 1,
    flexDirection: "row",
    minHeight: 0,
    backgroundColor: Theme.surface,
  },
  summaryPane: {
    flex: 1,
    minWidth: 0,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: Theme.borderLight,
    backgroundColor: Theme.surface,
  },
  summaryPaneContent: {
    paddingHorizontal: Layout.screenPaddingHorizontal,
    paddingTop: 12,
    paddingBottom: 16,
    maxWidth: 1360,
    width: "100%",
    alignSelf: "center",
  },
  summaryPaneContentCompact: {
    paddingTop: 4,
  },
  summaryPaneContentStacked: {
    paddingTop: 0,
    paddingBottom: 0,
    paddingHorizontal: 0,
  },
  bidsPane: {
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: 320,
    width: 320,
    minWidth: 280,
    maxWidth: 340,
    minHeight: 0,
    backgroundColor: Theme.screenBackground,
    ...Platform.select({
      web: {
        backgroundImage:
          "radial-gradient(ellipse 80% 50% at 50% 0%, rgba(205,233,247,0.35), transparent)",
      } as object,
      default: {},
    }),
  },
  bidsPaneHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 10,
    paddingTop: 10,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.borderLight,
    backgroundColor: Theme.cardWhite,
    gap: 6,
    zIndex: 2,
    ...Platform.select({
      web: { boxShadow: "0 1px 0 rgba(15,23,42,0.04)" } as object,
      ios: {
        shadowColor: Theme.shadow,
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.04,
        shadowRadius: 2,
      },
      default: {},
    }),
  },
  bidsPaneScroll: {
    flex: 1,
    minHeight: 0,
  },
  bidsPaneScrollContent: {
    paddingHorizontal: 10,
    paddingTop: 8,
    flexGrow: 1,
    alignItems: "stretch",
  },
  bidsPaneScrollContentCompact: {
    paddingTop: 6,
  },
});

export const indentReviewHubSpecValue = {
  ...indentReviewHubText.fieldValue,
  ...Platform.select({
    android: { includeFontPadding: false as const },
    default: {},
  }),
};
