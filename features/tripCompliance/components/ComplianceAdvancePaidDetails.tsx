import Theme from "@/constants/Theme";
import { ComplianceUtrEditRow } from "@/features/tripCompliance/components/ComplianceUtrEditRow";
import { fetchTripAdvanceLedger } from "@/features/tripCompliance/services/tripComplianceRead.service";
import type { CompliancePaymentSummary } from "@/features/tripCompliance/tripCompliance.types";
import { formatComplianceTimestamp } from "@/features/tripCompliance/utils/complianceCardVisual.util";
import { isCashPaymentMode } from "@/features/tripCompliance/utils/compliancePaymentReference.util";
import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";

const FINANCE_RECEIPT_PREFIX = "amount-paid:";

export type AdvanceUtrTarget = "compliance_advance" | "finance_receipt";

type LedgerPayment = CompliancePaymentSummary & { target: AdvanceUtrTarget };

function formatInr(amount: number): string {
  return `₹${amount.toLocaleString("en-IN")}`;
}

function DetailRow({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label} numberOfLines={2}>
        {label}
      </Text>
      <Text style={[styles.value, muted && styles.valueMuted]} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

/**
 * Posted advance: Amount, Mode, UTR (editable) and Paid at. Reads the live ledger
 * row(s) for the trip so a UTR already stored in the database always shows, and
 * the UTR is saved on the exact transaction it belongs to.
 */
export function ComplianceAdvancePaidDetails({
  advance,
  tripId,
  onUpdateUtr,
}: {
  advance: CompliancePaymentSummary;
  tripId: string;
  /** Saves the UTR on `transactionId`; rejects with a user-facing error. */
  onUpdateUtr?: (transactionId: string, utr: string, target: AdvanceUtrTarget) => Promise<void>;
}) {
  const fromFinance = advance.transactionId.startsWith(FINANCE_RECEIPT_PREFIX);
  const [payments, setPayments] = useState<LedgerPayment[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    fetchTripAdvanceLedger(tripId)
      .then(({ complianceAdvance, receipts }) => {
        if (cancelled) return;
        if (!fromFinance) {
          const row = complianceAdvance ?? advance;
          setPayments([{ ...row, target: "compliance_advance" }]);
          return;
        }
        setPayments(receipts.map((row) => ({ ...row, target: "finance_receipt" as const })));
      })
      .catch((e: unknown) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "Couldn't load the payment.");
      });
    return () => {
      cancelled = true;
    };
    // `advance` is read only as a fallback; refetch on identity changes below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId, fromFinance, advance.transactionId, advance.utr, reloadKey]);

  useEffect(() => {
    setPayments(null);
  }, [tripId]);

  const saveUtr = useCallback(
    async (payment: LedgerPayment, utr: string) => {
      await onUpdateUtr?.(payment.transactionId, utr, payment.target);
      setReloadKey((k) => k + 1);
    },
    [onUpdateUtr],
  );

  const renderPaymentRows = (payment: LedgerPayment) => {
    const isCash = isCashPaymentMode(payment.paymentMode);
    return (
      <>
        <View style={styles.rowBorder}>
          <DetailRow label="Mode" value={payment.paymentMode?.trim() || "—"} muted={!payment.paymentMode} />
        </View>
        <View style={styles.rowBorder}>
          <ComplianceUtrEditRow
            key={payment.transactionId}
            utr={payment.utr}
            canEdit={Boolean(onUpdateUtr) && !isCash}
            disabledReason={onUpdateUtr && isCash ? "Cash payment — no UTR" : null}
            onSave={(utr) => saveUtr(payment, utr)}
          />
        </View>
        <View style={styles.rowBorder}>
          <DetailRow label="Paid at" value={formatComplianceTimestamp(payment.paidAt)} />
        </View>
      </>
    );
  };

  const amountRow = <DetailRow label="Amount" value={formatInr(advance.amount)} />;

  if (loadError) {
    return (
      <View style={styles.card}>
        {amountRow}
        <View style={[styles.rowBorder, styles.stateRow]}>
          <Text style={styles.stateError} numberOfLines={2}>
            {loadError}
          </Text>
          <TouchableOpacity
            onPress={() => setReloadKey((k) => k + 1)}
            style={styles.retryBtn}
            hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel="Retry loading the payment"
          >
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (payments == null) {
    return (
      <View style={styles.card}>
        {amountRow}
        <View style={[styles.rowBorder, styles.stateRow]}>
          <ActivityIndicator size="small" color={Theme.textMuted} />
          <Text style={styles.stateText}>Loading payment details…</Text>
        </View>
      </View>
    );
  }

  if (payments.length === 0) {
    return (
      <View style={styles.card}>
        {amountRow}
        <View style={styles.rowBorder}>
          <DetailRow label="Mode" value="—" muted />
        </View>
        <View style={styles.rowBorder}>
          <ComplianceUtrEditRow
            utr={null}
            canEdit={false}
            disabledReason={onUpdateUtr ? "Payment entry isn't visible to your organisation" : null}
            onSave={async () => undefined}
          />
        </View>
      </View>
    );
  }

  if (payments.length === 1) {
    return (
      <View style={styles.card}>
        {amountRow}
        {renderPaymentRows(payments[0])}
      </View>
    );
  }

  return (
    <View style={styles.card}>
      {amountRow}
      {payments.map((payment, index) => (
        <View key={payment.transactionId} style={styles.receiptGroup}>
          <View style={styles.receiptHeader}>
            <Text style={styles.receiptTitle}>
              Payment {index + 1} of {payments.length}
            </Text>
            <Text style={styles.receiptAmount}>{formatInr(payment.amount)}</Text>
          </View>
          {renderPaymentRows(payment)}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Theme.complianceTripCardBorder,
    backgroundColor: Theme.cardWhite,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  rowBorder: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Theme.complianceTripCardBorder,
  },
  label: {
    width: 128,
    flexShrink: 0,
    fontSize: 8,
    fontWeight: "600",
    letterSpacing: 0.3,
    textTransform: "uppercase",
    color: Theme.textMuted,
    paddingTop: 1,
  },
  value: {
    flex: 1,
    minWidth: 0,
    textAlign: "right",
    fontSize: 11,
    fontWeight: "600",
    color: Theme.textPrimaryDark,
    lineHeight: 15,
  },
  valueMuted: { color: Theme.textMuted, fontWeight: "500" },
  stateRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  stateText: { fontSize: 10, fontWeight: "500", color: Theme.textMuted },
  stateError: {
    flex: 1,
    minWidth: 0,
    textAlign: "right",
    fontSize: 10,
    fontWeight: "600",
    color: Theme.complianceStageDocsFg,
  },
  retryBtn: {
    height: 24,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Theme.complianceTripCardBorder,
    alignItems: "center",
    justifyContent: "center",
  },
  retryText: { fontSize: 10, fontWeight: "700", color: Theme.textPrimaryDark },
  receiptGroup: {
    borderTopWidth: 1,
    borderTopColor: Theme.complianceTripCardBorder,
  },
  receiptHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: Theme.compliancePageBg,
  },
  receiptTitle: {
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 0.3,
    textTransform: "uppercase",
    color: Theme.textPrimaryDark,
  },
  receiptAmount: { fontSize: 10, fontWeight: "700", color: Theme.textPrimaryDark },
});
