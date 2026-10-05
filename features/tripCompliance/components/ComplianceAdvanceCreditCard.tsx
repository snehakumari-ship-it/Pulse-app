import Theme from "@/constants/Theme";
import { TinyEmptyLottie } from "@/components/TinyEmptyLottie";
import { CHAT_PAYMENT_LOTTIE, resolveChatPaymentLottieSource } from "@/lib/chatPaymentLottieAssets";
import type { CompliancePaymentSummary } from "@/features/tripCompliance/tripCompliance.types";
import { formatComplianceTxnDate } from "@/features/tripCompliance/utils/compliancePaymentDate.util";
import React, { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";

function formatInr(amount: number): string {
  return `₹${amount.toLocaleString("en-IN")}`;
}

function formatPaidWhen(payment: CompliancePaymentSummary): string {
  const day = formatComplianceTxnDate(payment.paidAt);
  const posted = payment.postedAt?.trim();
  if (!posted) return day || "—";
  try {
    const time = new Date(posted).toLocaleTimeString("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
    return day ? `${day} · ${time}` : time;
  } catch {
    return day || "—";
  }
}

/**
 * Hero + payment log for a posted advance (or a pre-verify advance that blocks
 * a second post). Large amount, party credit line, paid-at / mode with Lottie.
 */
export function ComplianceAdvanceCreditCard({
  payment,
  partyName,
  tone = "posted",
  footer,
}: {
  payment: CompliancePaymentSummary;
  /** Supplier / payee display name; falls back to "party". */
  partyName: string | null | undefined;
  tone?: "posted" | "blocked";
  footer?: React.ReactNode;
}) {
  const party = (partyName ?? "").trim() || "party";
  const mode = payment.paymentMode?.trim() || "—";
  const modeLottie = useMemo(
    () => resolveChatPaymentLottieSource("out", payment.paymentMode ?? "", false, false),
    [payment.paymentMode],
  );
  const blocked = tone === "blocked";

  return (
    <View style={[styles.card, blocked && styles.cardBlocked]}>
      <View style={styles.hero}>
        <View style={styles.heroCopy}>
          <Text style={styles.eyebrow}>{blocked ? "Advance on file" : "Advance credited"}</Text>
          <Text
            style={[styles.amount, blocked && styles.amountBlocked]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.7}
          >
            {formatInr(payment.amount)}
          </Text>
          <Text style={styles.partyLine} numberOfLines={2}>
            Credited to <Text style={styles.partyName}>{party}</Text>
          </Text>
        </View>
        <TinyEmptyLottie
          source={blocked ? CHAT_PAYMENT_LOTTIE.dispute : CHAT_PAYMENT_LOTTIE.outgoing}
          size={72}
          renderScale={1.35}
          speed={0.9}
        />
      </View>

      <View style={styles.log}>
        <Text style={styles.logTitle}>Payment log</Text>
        <View style={styles.logRow}>
          <TinyEmptyLottie source={CHAT_PAYMENT_LOTTIE.synced} size={28} renderScale={1.4} speed={0.8} />
          <View style={styles.logCopy}>
            <Text style={styles.logLabel}>Paid at</Text>
            <Text style={styles.logValue} numberOfLines={2}>
              {formatPaidWhen(payment)}
            </Text>
          </View>
        </View>
        <View style={[styles.logRow, styles.logRowBorder]}>
          <TinyEmptyLottie source={modeLottie} size={28} renderScale={1.4} speed={0.85} />
          <View style={styles.logCopy}>
            <Text style={styles.logLabel}>Mode of payment</Text>
            <Text style={[styles.logValue, mode === "—" && styles.logValueMuted]} numberOfLines={2}>
              {mode}
            </Text>
          </View>
        </View>
        {payment.utr?.trim() ? (
          <View style={[styles.logRow, styles.logRowBorder]}>
            <TinyEmptyLottie source={CHAT_PAYMENT_LOTTIE.bank} size={28} renderScale={1.4} speed={0.85} />
            <View style={styles.logCopy}>
              <Text style={styles.logLabel}>UTR / reference</Text>
              <Text style={styles.logValue} numberOfLines={2} selectable>
                {payment.utr.trim()}
              </Text>
            </View>
          </View>
        ) : null}
      </View>

      {footer ? <View style={styles.footer}>{footer}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Theme.complianceTripCardBorder,
    backgroundColor: Theme.cardWhite,
    overflow: "hidden",
  },
  cardBlocked: {
    borderColor: Theme.complianceStageDocsFg,
    backgroundColor: Theme.complianceStageDocsBg,
  },
  hero: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 12,
  },
  heroCopy: { flex: 1, minWidth: 0, gap: 4 },
  eyebrow: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.4,
    textTransform: "uppercase",
    color: Theme.textMuted,
  },
  amount: {
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: -0.6,
    color: Theme.textPrimaryDark,
    lineHeight: 34,
  },
  amountBlocked: { color: Theme.complianceStageDocsFg },
  partyLine: {
    fontSize: 13,
    fontWeight: "500",
    color: Theme.textSecondary,
    lineHeight: 18,
  },
  partyName: { fontWeight: "800", color: Theme.textPrimaryDark },
  log: {
    marginHorizontal: 10,
    marginBottom: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Theme.complianceTripCardBorder,
    backgroundColor: Theme.cardWhite,
    overflow: "hidden",
  },
  logTitle: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.35,
    textTransform: "uppercase",
    color: Theme.textMuted,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 4,
  },
  logRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  logRowBorder: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Theme.complianceTripCardBorder,
  },
  logCopy: { flex: 1, minWidth: 0, gap: 2 },
  logLabel: {
    fontSize: 10,
    fontWeight: "600",
    letterSpacing: 0.25,
    textTransform: "uppercase",
    color: Theme.textMuted,
  },
  logValue: {
    fontSize: 13,
    fontWeight: "700",
    color: Theme.textPrimaryDark,
    lineHeight: 17,
  },
  logValueMuted: { color: Theme.textMuted, fontWeight: "500" },
  footer: {
    paddingHorizontal: 12,
    paddingBottom: 12,
  },
});
