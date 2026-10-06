/**
 * Pulse Exchange settlement on a Marketplace trip, for the shipper and the
 * winning bidder (an org in the Business App, or a DCO in the Driver App, on
 * the same trip and rows). Either side records a payment; the other side
 * confirms it, and only then does it post to Finance (each side's party for the other).
 */
import Theme from "@/constants/Theme";
import { useOrganization } from "@/contexts/OrganizationContext";
import {
  useExchangeTripPaymentAction,
  useExchangeTripSummaryQuery,
} from "@/features/marketplace/hooks/useExchangeTripPayments";
import {
  isExchangeClaimOverdue,
  newExchangeIdempotencyKey,
  type ExchangePaymentMode,
  type ExchangePaymentRow,
  type ExchangeTripSummary,
} from "@/features/marketplace/services/exchangePayments.service";
import { showAppAlert } from "@/lib/appAlert";
import { formatINR } from "@/lib/format";
import { useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";

const MODES: { id: ExchangePaymentMode; label: string }[] = [
  { id: "BANK", label: "Bank" },
  { id: "UPI", label: "UPI" },
  { id: "CASH", label: "Cash" },
  { id: "CHEQUE", label: "Cheque" },
];

const MODE_LABEL: Record<ExchangePaymentMode, string> = {
  BANK: "Bank Transfer",
  UPI: "UPI",
  CASH: "Cash",
  CHEQUE: "Cheque",
};

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function viewerHasLedger(summary: ExchangeTripSummary): boolean {
  return summary.viewer_side === "payer" || summary.payee_kind !== "dco";
}

function statusLine(p: ExchangePaymentRow, summary: ExchangeTripSummary): { text: string; color: string } {
  if (p.status === "confirmed") {
    return { text: viewerHasLedger(summary) ? "Confirmed · posted to Finance" : "Confirmed · received", color: Theme.positive };
  }
  if (p.status === "rejected") return { text: `Rejected · ${p.decision_reason ?? ""}`.trim(), color: Theme.negative };
  if (p.status === "cancelled") return { text: "Withdrawn", color: Theme.textMuted };
  const waitingOnViewer = p.claimed_by_side !== summary.viewer_side;
  const overdue = isExchangeClaimOverdue(p) ? " · overdue" : "";
  return {
    text: (waitingOnViewer ? "Awaiting your confirmation" : "Awaiting their confirmation") + overdue,
    color: Theme.warning,
  };
}

export interface ExchangePaymentsPanelProps {
  tripId: string;
}

export function ExchangePaymentsPanel({ tripId }: ExchangePaymentsPanelProps) {
  const { currentOrganization } = useOrganization();
  const { data: summary, isLoading } = useExchangeTripSummaryQuery(tripId);
  const action = useExchangeTripPaymentAction(tripId, currentOrganization?.id);
  const [formOpen, setFormOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<ExchangePaymentMode>("BANK");
  const [reference, setReference] = useState("");
  const [paidOn, setPaidOn] = useState(todayISO());
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const claimKey = useRef<string | null>(null);

  if (isLoading || !summary) return null;

  const isPayer = summary.viewer_side === "payer";
  const counterparty = isPayer ? summary.payee_organization_name : summary.payer_organization_name;
  const outstanding = Math.max(0, summary.agreed_amount - summary.confirmed_amount);
  const recordable = Math.max(0, outstanding - summary.claimed_amount);
  const amountNum = Math.round((parseFloat(amount.replace(/,/g, "")) || 0) * 100) / 100;

  const run = (input: Parameters<typeof action.mutate>[0], onDone?: () => void) => {
    action.mutate(input, {
      onSuccess: () => onDone?.(),
      onError: (e) => showAppAlert("Pulse Exchange", e.message),
    });
  };

  const submitClaim = () => {
    if (amountNum <= 0) return;
    claimKey.current ??= newExchangeIdempotencyKey();
    run(
      {
        kind: "claim",
        input: {
          amount: amountNum,
          paymentMode: mode,
          paymentReference: reference,
          paidOn,
          idempotencyKey: claimKey.current,
        },
      },
      () => {
        claimKey.current = null;
        setFormOpen(false);
        setAmount("");
        setReference("");
        showAppAlert(
          "Sent for confirmation",
          viewerHasLedger(summary)
            ? `${counterparty ?? "The other side"} confirms it in Exchange; then it posts to Finance.`
            : `${counterparty ?? "The shipper"} confirms it in Exchange; then it counts as received.`,
        );
      },
    );
  };

  return (
    <View style={styles.card} testID="exchange-payments-panel">
      <View style={styles.kickerRow}>
        <View style={styles.kickerBar} />
        <Text style={styles.kicker}>Pulse Exchange</Text>
      </View>
      <Text style={styles.subtitle} numberOfLines={2}>
        Marketplace settlement {isPayer ? "to" : "from"} {counterparty ?? "the other party"}
      </Text>

      <View style={styles.totals}>
        <Total label="Agreed" value={summary.agreed_amount} />
        <Total label="Confirmed" value={summary.confirmed_amount} color={Theme.positive} />
        <Total label="Awaiting" value={summary.claimed_amount} color={Theme.warning} />
        <Total label={isPayer ? "To pay" : "To receive"} value={outstanding} />
      </View>

      {summary.payments.map((p) => {
        const status = statusLine(p, summary);
        const canDecide = p.status === "claimed" && p.claimed_by_side !== summary.viewer_side;
        const canWithdraw = p.status === "claimed" && p.claimed_by_side === summary.viewer_side;
        return (
          <View key={p.id} style={styles.payment}>
            <View style={styles.paymentHead}>
              <Text style={styles.paymentAmount}>{formatINR(Number(p.amount))}</Text>
              <Text style={styles.paymentMeta} numberOfLines={1}>
                {MODE_LABEL[p.payment_mode]}
                {p.payment_reference ? ` · ${p.payment_reference}` : ""} · {p.paid_on}
              </Text>
            </View>
            <Text style={[styles.paymentStatus, { color: status.color }]}>{status.text}</Text>
            {canDecide && rejectingId !== p.id ? (
              <View style={styles.actions}>
                <Action
                  label="Confirm"
                  primary
                  disabled={action.isPending}
                  onPress={() => run({ kind: "confirm", paymentId: p.id })}
                />
                <Action label="Reject" disabled={action.isPending} onPress={() => setRejectingId(p.id)} />
              </View>
            ) : null}
            {canDecide && rejectingId === p.id ? (
              <View style={styles.rejectBox}>
                <TextInput
                  style={styles.input}
                  value={rejectReason}
                  onChangeText={setRejectReason}
                  placeholder="Reason (e.g. not received)"
                  placeholderTextColor={Theme.textMuted}
                />
                <View style={styles.actions}>
                  <Action
                    label="Reject payment"
                    disabled={action.isPending || !rejectReason.trim()}
                    onPress={() =>
                      run({ kind: "reject", paymentId: p.id, reason: rejectReason }, () => {
                        setRejectingId(null);
                        setRejectReason("");
                      })
                    }
                  />
                  <Action label="Back" onPress={() => setRejectingId(null)} />
                </View>
              </View>
            ) : null}
            {canWithdraw ? (
              <View style={styles.actions}>
                <Action
                  label="Withdraw"
                  disabled={action.isPending}
                  onPress={() => run({ kind: "cancel", paymentId: p.id })}
                />
              </View>
            ) : null}
          </View>
        );
      })}

      {formOpen ? (
        <View style={styles.form}>
          <TextInput
            style={styles.input}
            value={amount}
            onChangeText={setAmount}
            keyboardType="decimal-pad"
            placeholder={`Amount (up to ${formatINR(recordable)})`}
            placeholderTextColor={Theme.textMuted}
            accessibilityLabel="Amount"
          />
          <View style={styles.modes}>
            {MODES.map((m) => (
              <TouchableOpacity
                key={m.id}
                style={[styles.modeChip, mode === m.id && styles.modeChipOn]}
                onPress={() => setMode(m.id)}
                accessibilityRole="radio"
                accessibilityState={{ selected: mode === m.id }}
              >
                <Text style={[styles.modeTxt, mode === m.id && styles.modeTxtOn]}>{m.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TextInput
            style={styles.input}
            value={reference}
            onChangeText={setReference}
            placeholder="UTR / reference"
            placeholderTextColor={Theme.textMuted}
            autoCapitalize="characters"
          />
          <TextInput
            style={styles.input}
            value={paidOn}
            onChangeText={setPaidOn}
            placeholder="Paid on (YYYY-MM-DD)"
            placeholderTextColor={Theme.textMuted}
          />
          <View style={styles.actions}>
            <Action
              label={isPayer ? "Record payment made" : "Record payment received"}
              primary
              disabled={action.isPending || amountNum <= 0 || amountNum > recordable}
              onPress={submitClaim}
            />
            <Action label="Cancel" onPress={() => setFormOpen(false)} />
          </View>
        </View>
      ) : recordable > 0 ? (
        <Action
          label={isPayer ? "Record payment made" : "Record payment received"}
          onPress={() => setFormOpen(true)}
        />
      ) : null}

      {action.isPending ? <ActivityIndicator color={Theme.primary} style={styles.spinner} /> : null}
    </View>
  );
}

function Total({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <View style={styles.total}>
      <Text style={styles.totalLabel}>{label}</Text>
      <Text style={[styles.totalValue, color ? { color } : null]} numberOfLines={1}>
        {formatINR(Number(value))}
      </Text>
    </View>
  );
}

function Action({
  label,
  onPress,
  primary,
  disabled,
}: {
  label: string;
  onPress: () => void;
  primary?: boolean;
  disabled?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[styles.action, primary && styles.actionPrimary, disabled && styles.actionDisabled]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
    >
      <Text style={[styles.actionTxt, primary && styles.actionTxtPrimary]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Theme.screenBackground,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Theme.borderLight,
    padding: 16,
    marginTop: 12,
    gap: 10,
  },
  kickerRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  kickerBar: { width: 3, height: 14, borderRadius: 2, backgroundColor: Theme.primary },
  kicker: { fontSize: 12, fontWeight: "700", letterSpacing: 0.6, color: Theme.primary, textTransform: "uppercase" },
  subtitle: { fontSize: 13, color: Theme.textPrimary, minWidth: 0 },
  totals: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  total: { flexBasis: "47%", flexGrow: 1, minWidth: 0, backgroundColor: Theme.surface, borderRadius: 10, padding: 10 },
  totalLabel: { fontSize: 11, color: Theme.textMuted },
  totalValue: { fontSize: 15, fontWeight: "700", color: Theme.textPrimaryDark, marginTop: 2 },
  payment: { borderTopWidth: 1, borderTopColor: Theme.borderLight, paddingTop: 10, gap: 4 },
  paymentHead: { flexDirection: "row", alignItems: "baseline", gap: 8, minWidth: 0 },
  paymentAmount: { fontSize: 15, fontWeight: "700", color: Theme.textPrimaryDark },
  paymentMeta: { flex: 1, minWidth: 0, fontSize: 12, color: Theme.textMuted },
  paymentStatus: { fontSize: 12, fontWeight: "600" },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  action: {
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Theme.borderLight,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Theme.surfaceGray,
  },
  actionPrimary: { backgroundColor: Theme.primary, borderColor: Theme.primary },
  actionDisabled: { opacity: 0.5 },
  actionTxt: { fontSize: 13, fontWeight: "600", color: Theme.textPrimaryDark },
  actionTxtPrimary: { color: Theme.screenBackground },
  rejectBox: { gap: 6 },
  form: { gap: 8, borderTopWidth: 1, borderTopColor: Theme.borderLight, paddingTop: 10 },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: Theme.borderLight,
    borderRadius: 10,
    paddingHorizontal: 12,
    fontSize: 14,
    color: Theme.textPrimaryDark,
    backgroundColor: Theme.surface,
  },
  modes: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  modeChip: {
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: Theme.borderLight,
    justifyContent: "center",
  },
  modeChipOn: { backgroundColor: Theme.primary, borderColor: Theme.primary },
  modeTxt: { fontSize: 13, color: Theme.textPrimaryDark },
  modeTxtOn: { color: Theme.screenBackground, fontWeight: "600" },
  spinner: { marginTop: 4 },
});
