import Theme from "@/constants/Theme";
import { ComplianceAdvanceCreditCard } from "@/features/tripCompliance/components/ComplianceAdvanceCreditCard";
import { CompliancePaidAtEditRow } from "@/features/tripCompliance/components/CompliancePaidAtEditRow";
import { ComplianceUtrEditRow } from "@/features/tripCompliance/components/ComplianceUtrEditRow";
import { fetchTripAdvanceLedger } from "@/features/tripCompliance/services/tripComplianceRead.service";
import type { CompliancePaymentSummary } from "@/features/tripCompliance/tripCompliance.types";
import { isCashPaymentMode } from "@/features/tripCompliance/utils/compliancePaymentReference.util";
import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";

const FINANCE_RECEIPT_PREFIX = "amount-paid:";

export type AdvanceUtrTarget = "compliance_advance" | "finance_receipt";

type LedgerPayment = CompliancePaymentSummary & { target: AdvanceUtrTarget };

function formatInr(amount: number): string {
  return `₹${amount.toLocaleString("en-IN")}`;
}

/**
 * Posted advance: credit hero (amount, party, paid-at / mode log) plus editable
 * UTR and Paid at. Reads live ledger rows so edits land on the right transaction.
 */
export function ComplianceAdvancePaidDetails({
  advance,
  tripId,
  partyName,
  onUpdateUtr,
  onUpdatePaidAt,
}: {
  advance: CompliancePaymentSummary;
  tripId: string;
  /** Supplier / payee shown on the credit hero. */
  partyName?: string | null;
  /** Saves the UTR on `transactionId`; rejects with a user-facing error. */
  onUpdateUtr?: (transactionId: string, utr: string, target: AdvanceUtrTarget) => Promise<void>;
  /** Saves the transaction date (Paid at) on `transactionId`. */
  onUpdatePaidAt?: (
    transactionId: string,
    transactionDate: string,
    target: AdvanceUtrTarget,
  ) => Promise<void>;
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
  }, [tripId, fromFinance, advance.transactionId, advance.utr, advance.paidAt, reloadKey]);

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

  const savePaidAt = useCallback(
    async (payment: LedgerPayment, transactionDate: string) => {
      await onUpdatePaidAt?.(payment.transactionId, transactionDate, payment.target);
      setReloadKey((k) => k + 1);
    },
    [onUpdatePaidAt],
  );

  const renderEditableRows = (payment: LedgerPayment, first?: boolean) => {
    const isCash = isCashPaymentMode(payment.paymentMode);
    return (
      <>
        <View style={!first ? styles.rowBorder : undefined}>
          <ComplianceUtrEditRow
            key={`${payment.transactionId}-utr`}
            utr={payment.utr}
            canEdit={Boolean(onUpdateUtr) && !isCash}
            disabledReason={onUpdateUtr && isCash ? "Cash payment — no UTR" : null}
            onSave={(utr) => saveUtr(payment, utr)}
          />
        </View>
        <View style={styles.rowBorder}>
          <CompliancePaidAtEditRow
            key={`${payment.transactionId}-paid-at`}
            paidAt={payment.paidAt}
            canEdit={Boolean(onUpdatePaidAt)}
            onSave={(transactionDate) => savePaidAt(payment, transactionDate)}
          />
        </View>
      </>
    );
  };

  const creditHero = (
    <ComplianceAdvanceCreditCard
      payment={advance}
      partyName={partyName}
      tone="posted"
    />
  );

  if (loadError) {
    return (
      <View style={styles.stack}>
        {creditHero}
        <View style={styles.card}>
          <View style={styles.stateRow}>
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
      </View>
    );
  }

  if (payments == null) {
    return (
      <View style={styles.stack}>
        {creditHero}
        <View style={styles.card}>
          <View style={styles.stateRow}>
            <ActivityIndicator size="small" color={Theme.textMuted} />
            <Text style={styles.stateText}>Loading payment details…</Text>
          </View>
        </View>
      </View>
    );
  }

  if (payments.length === 0) {
    return (
      <View style={styles.stack}>
        {creditHero}
        <View style={styles.card}>
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
      <View style={styles.stack}>
        <ComplianceAdvanceCreditCard payment={payments[0]} partyName={partyName} tone="posted" />
        <View style={styles.card}>{renderEditableRows(payments[0], true)}</View>
      </View>
    );
  }

  return (
    <View style={styles.stack}>
      {creditHero}
      <View style={styles.card}>
        {payments.map((payment, index) => (
          <View key={payment.transactionId} style={index > 0 ? styles.receiptGroup : undefined}>
            <View style={styles.receiptHeader}>
              <Text style={styles.receiptTitle}>
                Payment {index + 1} of {payments.length}
              </Text>
              <Text style={styles.receiptAmount}>{formatInr(payment.amount)}</Text>
            </View>
            {renderEditableRows(payment, true)}
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 10 },
  card: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Theme.complianceTripCardBorder,
    backgroundColor: Theme.cardWhite,
    overflow: "hidden",
  },
  rowBorder: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Theme.complianceTripCardBorder,
  },
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
