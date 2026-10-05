/**
 * Advance Processed stage — table view. One payment row per trip (supplier bank
 * details, approver, mode, date, amount) with inline Request ID and UTR entry:
 * type in the box, press Enter or ✓. Columns flex to the screen width.
 */
import Theme from "@/constants/Theme";
import { useAdvanceProcessedTable } from "@/features/tripCompliance/hooks/useAdvanceProcessedTable";
import type { AdvanceProcessedEnrichment } from "@/features/tripCompliance/services/complianceAdvanceProcessed.service";
import {
  updateCompliancePaymentReference,
  updateCompliancePaymentRequestId,
} from "@/features/tripCompliance/services/tripComplianceWrite.service";
import type { ComplianceTripSummary } from "@/features/tripCompliance/tripCompliance.types";
import {
  COMPLIANCE_REQUEST_ID_MAX_LENGTH,
  COMPLIANCE_UTR_MAX_LENGTH,
  isCashPaymentMode,
  normalizeComplianceRequestId,
  normalizeComplianceUtr,
  validateComplianceRequestId,
  validateComplianceUtr,
} from "@/features/tripCompliance/utils/compliancePaymentReference.util";
import { latestDocNumber } from "@/features/tripCompliance/utils/complianceVerifiedExport.util";
import { getTripDisplayNumber } from "@/features/trips/services/trips.service";
import { formatIndianVehicleNumber } from "@/lib/format";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Pencil } from "lucide-react-native";
import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  type TextStyle,
  type ViewStyle,
} from "react-native";

type EditField = "requestId" | "utr";

const FIELD_CONFIG: Record<
  EditField,
  {
    placeholder: string;
    maxLength: number;
    normalize: (value: string) => string;
    validate: (value: string) => string | null;
    label: string;
  }
> = {
  requestId: {
    placeholder: "Request ID",
    maxLength: COMPLIANCE_REQUEST_ID_MAX_LENGTH,
    normalize: normalizeComplianceRequestId,
    validate: validateComplianceRequestId,
    label: "Request ID",
  },
  utr: {
    placeholder: "Type UTR",
    maxLength: COMPLIANCE_UTR_MAX_LENGTH,
    normalize: normalizeComplianceUtr,
    validate: validateComplianceUtr,
    label: "UTR",
  },
};

const COL = {
  trip: { flex: 1.25, minWidth: 0 },
  lr: { flex: 0.6, minWidth: 0 },
  truck: { flex: 0.85, minWidth: 0 },
  payType: { flex: 0.65, minWidth: 0 },
  supplier: { flex: 1.1, minWidth: 0 },
  approved: { flex: 0.8, minWidth: 0 },
  beneficiary: { flex: 1.1, minWidth: 0 },
  bank: { flex: 0.85, minWidth: 0 },
  ifsc: { flex: 0.85, minWidth: 0 },
  account: { flex: 0.95, minWidth: 0 },
  branch: { flex: 0.8, minWidth: 0 },
  mode: { flex: 0.55, minWidth: 0 },
  date: { flex: 0.75, minWidth: 0 },
  amount: { flex: 0.75, minWidth: 0 },
  requestId: { flex: 1.0, minWidth: 104 },
  utr: { flex: 1.15, minWidth: 120 },
} satisfies Record<string, ViewStyle>;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatTxnDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return `${String(date.getDate()).padStart(2, "0")} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

function formatInr(amount: number): string {
  return `₹${amount.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function HeaderCell({ label, style, align, accent }: { label: string; style: ViewStyle; align?: "right"; accent?: boolean }) {
  return (
    <View style={[styles.cell, styles.headerCell, style, accent && styles.headerAccent]}>
      <Text
        style={[styles.headerText, align === "right" && styles.alignRight, accent && styles.headerAccentText]}
        numberOfLines={2}
      >
        {label}
      </Text>
    </View>
  );
}

function Cell({
  style,
  value,
  sub,
  loading,
  align,
  strong,
  mono,
}: {
  style: ViewStyle;
  value: string;
  sub?: string | null;
  loading?: boolean;
  align?: "right";
  strong?: boolean;
  mono?: boolean;
}) {
  const empty = !value;
  return (
    <View style={[styles.cell, style]}>
      <Text
        style={[
          styles.cellText,
          strong && styles.cellStrong,
          mono && styles.cellMono,
          empty && styles.cellEmpty,
          align === "right" && styles.alignRight,
        ]}
        numberOfLines={2}
        selectable={!empty}
      >
        {loading && empty ? "…" : value || "—"}
      </Text>
      {sub ? (
        <Text style={[styles.cellSub, align === "right" && styles.alignRight]} numberOfLines={2}>
          {sub}
        </Text>
      ) : null}
    </View>
  );
}

function Checkbox({ checked, onPress, label }: { checked: boolean; onPress: () => void; label: string }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={styles.selectCell}
      hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={label}
    >
      <View style={[styles.checkbox, checked && styles.checkboxOn]}>
        {checked ? <Check size={10} color={Theme.cardWhite} strokeWidth={3} /> : null}
      </View>
    </TouchableOpacity>
  );
}

type EditState = { draft: string; saving: boolean; error: string | null; editing: boolean };
const EMPTY_EDIT: EditState = { draft: "", saving: false, error: null, editing: false };

function EditableCell({
  field,
  style,
  saved,
  state,
  disabledLabel,
  onChange,
  onSave,
  onEdit,
}: {
  field: EditField;
  style: ViewStyle;
  saved: string;
  state: EditState | undefined;
  disabledLabel: string | null;
  onChange: (value: string) => void;
  onSave: () => void;
  onEdit: () => void;
}) {
  const config = FIELD_CONFIG[field];
  if (disabledLabel) {
    return (
      <View style={[styles.cell, style]}>
        <Text style={styles.editDisabled} numberOfLines={2}>
          {disabledLabel}
        </Text>
      </View>
    );
  }
  if (!state?.editing && saved) {
    return (
      <View style={[styles.cell, style]}>
        <TouchableOpacity
          style={styles.savedChip}
          onPress={onEdit}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel={`${config.label} ${saved}. Edit`}
        >
          <View style={styles.savedBody}>
            <Text style={styles.savedValue} numberOfLines={2} selectable>
              {saved}
            </Text>
            <View style={styles.savedTag}>
              <Check size={8} color={Theme.complianceStageSuccessFg} strokeWidth={3} />
              <Text style={styles.savedTagText}>Saved</Text>
            </View>
          </View>
          <Pencil size={10} color={Theme.complianceStageSuccessFg} strokeWidth={2.2} />
        </TouchableOpacity>
      </View>
    );
  }
  const draft = state?.editing ? state.draft : "";
  const dirty = config.normalize(draft).length > 0 && config.normalize(draft) !== saved;
  const idle = !dirty || Boolean(state?.saving);
  return (
    <View style={[styles.cell, style]}>
      <View style={styles.editLine}>
        <TextInput
          value={draft}
          onChangeText={(text) => onChange(text.toUpperCase())}
          onSubmitEditing={onSave}
          placeholder={config.placeholder}
          placeholderTextColor={Theme.textMuted}
          autoCapitalize="characters"
          autoCorrect={false}
          spellCheck={false}
          maxLength={config.maxLength}
          editable={!state?.saving}
          returnKeyType="done"
          style={[styles.input, state?.error ? styles.inputError : null] as TextStyle[]}
          accessibilityLabel={config.label}
        />
        <TouchableOpacity
          onPress={onSave}
          disabled={idle}
          style={[styles.saveBtn, idle && styles.saveBtnIdle]}
          hitSlop={{ top: 10, bottom: 10, left: 6, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel={`Save ${config.label}`}
        >
          {state?.saving ? (
            <ActivityIndicator size="small" color={Theme.cardWhite} />
          ) : (
            <Check size={13} color={Theme.cardWhite} strokeWidth={3} />
          )}
        </TouchableOpacity>
      </View>
      {state?.error ? (
        <Text style={styles.editError} numberOfLines={2}>
          {state.error}
        </Text>
      ) : null}
    </View>
  );
}

export function ComplianceAdvanceProcessedTable({
  summaries,
  organizationId,
  onOpenTrip,
  onUtrSaved,
}: {
  summaries: ComplianceTripSummary[];
  organizationId: string;
  onOpenTrip: (tripId: string) => void;
  /** After a UTR / Request ID is saved — refresh that trip's payment inputs. */
  onUtrSaved?: (tripId: string) => void;
}) {
  const queryClient = useQueryClient();
  const rows = useMemo(() => summaries.filter((s) => s.advance), [summaries]);
  const { data: enrichment, isPending, isFetching } = useAdvanceProcessedTable(organizationId, rows);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [edits, setEdits] = useState<Record<string, EditState>>({});
  /** Saved values shown until refetched data catches up. */
  const [savedLocal, setSavedLocal] = useState<Record<string, string>>({});
  const [bulkSaving, setBulkSaving] = useState(false);

  const editKey = (tripId: string, field: EditField) => `${tripId}:${field}`;

  const savedValue = useCallback(
    (summary: ComplianceTripSummary, info: AdvanceProcessedEnrichment | undefined, field: EditField) => {
      const local = savedLocal[editKey(summary.trip.id, field)];
      if (local != null) return local;
      if (field === "utr") return (info?.payment?.utr ?? summary.advance?.utr ?? "").trim();
      return (info?.requestId ?? "").trim();
    },
    [savedLocal],
  );

  const patchEdit = (key: string, patch: Partial<EditState>) =>
    setEdits((cur) => ({ ...cur, [key]: { ...(cur[key] ?? EMPTY_EDIT), ...patch } }));

  const saveField = useCallback(
    async (summary: ComplianceTripSummary, field: EditField) => {
      const tripId = summary.trip.id;
      const key = editKey(tripId, field);
      const info = enrichment?.[tripId];
      const config = FIELD_CONFIG[field];
      const value = config.normalize(edits[key]?.draft ?? "");
      const invalid = config.validate(value);
      if (invalid) {
        patchEdit(key, { error: invalid });
        return false;
      }
      if (!info?.transactionId) {
        patchEdit(key, { error: "Payment not found. Refresh and try again." });
        return false;
      }
      patchEdit(key, { saving: true, error: null });
      const target = { tripId, transactionId: info.transactionId, category: info.utrCategory };
      const { error } =
        field === "utr"
          ? await updateCompliancePaymentReference({ ...target, utr: value })
          : await updateCompliancePaymentRequestId({ ...target, requestId: value });
      if (error) {
        patchEdit(key, { saving: false, error: error.message });
        return false;
      }
      setSavedLocal((cur) => ({ ...cur, [key]: value }));
      patchEdit(key, { saving: false, editing: false, draft: value });
      void queryClient.invalidateQueries({ queryKey: ["q", "tripCompliance", "advanceProcessed"] });
      onUtrSaved?.(tripId);
      return true;
    },
    [edits, enrichment, onUtrSaved, queryClient],
  );

  const pendingSelected = rows.flatMap((summary) => {
    if (!selected.has(summary.trip.id)) return [];
    return (["requestId", "utr"] as const).filter((field) => {
      const state = edits[editKey(summary.trip.id, field)];
      if (!state?.editing) return false;
      const draft = FIELD_CONFIG[field].normalize(state.draft);
      return draft.length > 0 && draft !== savedValue(summary, enrichment?.[summary.trip.id], field);
    }).map((field) => ({ summary, field }));
  });

  const saveSelected = async () => {
    if (bulkSaving) return;
    setBulkSaving(true);
    for (const { summary, field } of pendingSelected) {
      await saveField(summary, field);
    }
    setBulkSaving(false);
  };

  const allSelected = rows.length > 0 && rows.every((s) => selected.has(s.trip.id));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(rows.map((s) => s.trip.id)));
  const toggle = (tripId: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(tripId)) next.delete(tripId);
      else next.add(tripId);
      return next;
    });
  const missingUtr = rows.filter((s) => !savedValue(s, enrichment?.[s.trip.id], "utr")).length;

  return (
    <View style={styles.wrap}>
      <View style={styles.titleBar}>
        <View style={styles.titleLeft}>
          <Text style={styles.title} numberOfLines={1}>
            Advance processed payments
          </Text>
          <View style={styles.titleCount}>
            <Text style={styles.titleCountText}>{rows.length}</Text>
          </View>
          {rows.length > 0 ? (
            <Text style={styles.titleMuted} numberOfLines={1}>
              {missingUtr > 0 ? `${missingUtr} awaiting UTR` : "All UTRs recorded"}
            </Text>
          ) : null}
          {isFetching ? <ActivityIndicator size="small" color={Theme.compliancePayTableTitleMuted} /> : null}
        </View>
        {selected.size > 0 ? (
          <View style={styles.titleRight}>
            <Text style={styles.titleMuted}>{selected.size} selected</Text>
            <TouchableOpacity
              onPress={() => setSelected(new Set())}
              style={styles.titleGhostBtn}
              hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
              accessibilityRole="button"
              accessibilityLabel="Clear selection"
            >
              <Text style={styles.titleGhostText}>Clear</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => void saveSelected()}
              disabled={pendingSelected.length === 0 || bulkSaving}
              style={[styles.titleSaveBtn, (pendingSelected.length === 0 || bulkSaving) && styles.titleSaveBtnIdle]}
              hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
              accessibilityRole="button"
              accessibilityLabel="Save edits for selected trips"
            >
              {bulkSaving ? (
                <ActivityIndicator size="small" color={Theme.cardWhite} />
              ) : (
                <Text style={styles.titleSaveText}>
                  {pendingSelected.length > 0 ? `Save ${pendingSelected.length}` : "Save"}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        ) : null}
      </View>

      <View style={[styles.row, styles.headerRow]}>
        <Checkbox checked={allSelected} onPress={toggleAll} label="Select all trips" />
        <HeaderCell label="Trip ID" style={COL.trip} />
        <HeaderCell label="LR No." style={COL.lr} />
        <HeaderCell label="Truck No." style={COL.truck} />
        <HeaderCell label="Payment Type" style={COL.payType} />
        <HeaderCell label="Supplier Name" style={COL.supplier} />
        <HeaderCell label="Approved By" style={COL.approved} />
        <HeaderCell label="Beneficiary" style={COL.beneficiary} />
        <HeaderCell label="Bank Name" style={COL.bank} />
        <HeaderCell label="IFSC" style={COL.ifsc} />
        <HeaderCell label="Account No." style={COL.account} />
        <HeaderCell label="Account Branch" style={COL.branch} />
        <HeaderCell label="Mode" style={COL.mode} />
        <HeaderCell label="Txn Date" style={COL.date} />
        <HeaderCell label="Amount" style={COL.amount} align="right" />
        <View style={styles.headerAccentGroup}>
          <HeaderCell label="Request ID" style={COL.requestId} accent />
          <HeaderCell label="UTR" style={COL.utr} accent />
        </View>
      </View>

      {rows.map((summary, index) => {
        const trip = summary.trip;
        const tripNumber = getTripDisplayNumber(trip, trip.organization_id ?? null);
        const info = enrichment?.[trip.id];
        const loading = isPending && !info;
        const payment = info?.payment ?? summary.advance!;
        const isSelected = selected.has(trip.id);
        const supplier = info?.supplierName || trip.supplier_name || "";
        const beneficiary = info?.beneficiaryName || supplier;
        const noEntry = !loading && info && !info.transactionId;
        const rowLabel = (field: EditField) =>
          loading ? "Loading…" : noEntry ? "Entry not visible to your org" : field === "utr" && isCashPaymentMode(payment.paymentMode) ? "Cash · no UTR" : null;
        const renderEditable = (field: EditField, style: ViewStyle) => {
          const key = editKey(trip.id, field);
          const saved = savedValue(summary, info, field);
          return (
            <EditableCell
              field={field}
              style={style}
              saved={saved}
              state={edits[key]}
              disabledLabel={rowLabel(field)}
              onChange={(value) => patchEdit(key, { draft: value, error: null, editing: true })}
              onEdit={() => patchEdit(key, { draft: saved, editing: true, error: null })}
              onSave={() => void saveField(summary, field)}
            />
          );
        };
        return (
          <View
            key={trip.id}
            style={[styles.row, index % 2 === 1 && styles.rowAlt, isSelected && styles.rowSelected]}
          >
            <Checkbox checked={isSelected} onPress={() => toggle(trip.id)} label={`Select trip ${tripNumber}`} />
            <View style={[styles.cell, COL.trip]}>
              <TouchableOpacity onPress={() => onOpenTrip(trip.id)} hitSlop={{ top: 8, bottom: 8 }} accessibilityRole="link">
                <Text style={[styles.cellText, styles.tripLink]} numberOfLines={2}>
                  {tripNumber}
                </Text>
              </TouchableOpacity>
              {trip.client_name ? (
                <Text style={styles.cellSub} numberOfLines={1}>
                  {trip.client_name}
                </Text>
              ) : null}
            </View>
            <Cell style={COL.lr} value={latestDocNumber(summary.documents, "lr")} />
            <Cell
              style={COL.truck}
              value={formatIndianVehicleNumber(trip.vehicle_display_number?.trim() || "").trim()}
              strong
            />
            <Cell style={COL.payType} value="Advance" />
            <Cell style={COL.supplier} value={supplier} loading={loading} />
            <Cell style={COL.approved} value={info?.approvedBy ?? ""} loading={loading} />
            <Cell style={COL.beneficiary} value={beneficiary} loading={loading} />
            <Cell style={COL.bank} value={info?.bankName ?? ""} loading={loading} />
            <Cell style={COL.ifsc} value={info?.ifsc ?? ""} loading={loading} mono />
            <Cell style={COL.account} value={info?.accountNumber ?? ""} loading={loading} mono strong />
            <Cell style={COL.branch} value={info?.branch ?? ""} loading={loading} />
            <Cell style={COL.mode} value={payment.paymentMode?.trim() ?? ""} />
            <Cell style={COL.date} value={formatTxnDate(payment.paidAt)} />
            <Cell
              style={COL.amount}
              value={formatInr(summary.advance!.amount)}
              sub={info?.extraReceipts ? `${info.extraReceipts + 1} receipts` : null}
              align="right"
              strong
            />
            {renderEditable("requestId", COL.requestId)}
            {renderEditable("utr", COL.utr)}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: "100%",
    minWidth: 0,
    borderWidth: 1,
    borderColor: Theme.complianceCardBorder,
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: Theme.cardWhite,
  },
  titleBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    backgroundColor: Theme.compliancePayTableTitleBg,
  },
  titleLeft: { flexDirection: "row", alignItems: "center", gap: 8, minWidth: 0, flexShrink: 1 },
  title: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    color: Theme.compliancePayTableTitleFg,
  },
  titleCount: {
    minWidth: 20,
    height: 18,
    paddingHorizontal: 6,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Theme.compliancePayTableUtrHeaderBg,
  },
  titleCountText: { fontSize: 10, fontWeight: "700", color: Theme.compliancePayTableTitleFg },
  titleMuted: { fontSize: 10, fontWeight: "500", color: Theme.compliancePayTableTitleMuted },
  titleRight: { flexDirection: "row", alignItems: "center", gap: 10 },
  titleGhostBtn: { height: 26, paddingHorizontal: 8, justifyContent: "center" },
  titleGhostText: { fontSize: 10, fontWeight: "700", color: Theme.compliancePayTableTitleFg },
  titleSaveBtn: {
    height: 26,
    minWidth: 64,
    paddingHorizontal: 12,
    borderRadius: 7,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Theme.compliancePayTableUtrHeaderBg,
  },
  titleSaveBtnIdle: { opacity: 0.45 },
  titleSaveText: { fontSize: 10, fontWeight: "700", color: Theme.compliancePayTableTitleFg },
  row: {
    flexDirection: "row",
    alignItems: "center",
    borderTopWidth: 1,
    borderTopColor: Theme.border,
    borderLeftWidth: 3,
    borderLeftColor: Theme.cardWhite,
    paddingRight: 6,
    gap: 6,
    minHeight: 50,
  },
  rowAlt: { backgroundColor: Theme.compliancePageBg, borderLeftColor: Theme.compliancePageBg },
  rowSelected: {
    backgroundColor: Theme.compliancePayTableRowSelectedBg,
    borderLeftColor: Theme.compliancePayTableRowSelectedBorder,
  },
  headerRow: {
    borderTopWidth: 0,
    backgroundColor: Theme.compliancePageBg,
    borderLeftColor: Theme.compliancePageBg,
    minHeight: 38,
    alignItems: "stretch",
  },
  headerCell: { paddingVertical: 6 },
  headerAccentGroup: {
    flexGrow: COL.requestId.flex + COL.utr.flex,
    flexShrink: 1,
    /** The inner gap sits outside flex in data rows; reserving it keeps columns aligned. */
    flexBasis: 6,
    minWidth: COL.requestId.minWidth + COL.utr.minWidth + 6,
    flexDirection: "row",
    gap: 6,
    marginRight: -6,
    paddingRight: 6,
    backgroundColor: Theme.compliancePayTableUtrHeaderBg,
  },
  headerAccent: { alignItems: "center", paddingHorizontal: 4 },
  headerText: {
    fontSize: 9,
    fontWeight: "700",
    lineHeight: 12,
    color: Theme.textPrimary,
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  headerAccentText: { color: Theme.compliancePayTableTitleFg, textAlign: "center", letterSpacing: 0.5 },
  cell: { justifyContent: "center", gap: 2, paddingVertical: 6 },
  cellText: { fontSize: 11, lineHeight: 14, fontWeight: "500", color: Theme.textPrimary },
  cellStrong: { fontWeight: "700", color: Theme.textPrimaryDark },
  cellMono: { letterSpacing: 0.2, fontVariant: ["tabular-nums"] },
  cellEmpty: { color: Theme.textMuted, fontWeight: "500" },
  cellSub: { fontSize: 9, lineHeight: 12, fontWeight: "500", color: Theme.textMuted },
  alignRight: { textAlign: "right" },
  tripLink: { fontWeight: "700", color: Theme.complianceBulk },
  selectCell: { width: 30, alignItems: "center", justifyContent: "center", alignSelf: "stretch" },
  checkbox: {
    width: 15,
    height: 15,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: Theme.textMuted,
    backgroundColor: Theme.cardWhite,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxOn: {
    borderColor: Theme.compliancePayTableRowSelectedBorder,
    backgroundColor: Theme.compliancePayTableRowSelectedBorder,
  },
  editLine: { flexDirection: "row", alignItems: "center", gap: 4 },
  input: {
    flex: 1,
    minWidth: 0,
    height: 28,
    paddingHorizontal: 7,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: Theme.complianceCardBorder,
    backgroundColor: Theme.cardWhite,
    fontSize: 10,
    fontWeight: "600",
    letterSpacing: 0.3,
    color: Theme.textPrimaryDark,
    ...(Platform.OS === "web" ? { outlineStyle: "none" } : null),
  },
  inputError: { borderColor: Theme.complianceStageDocsFg },
  saveBtn: {
    width: 28,
    height: 28,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Theme.compliancePayTableUtrHeaderBg,
  },
  saveBtnIdle: { opacity: 0.3 },
  editError: { fontSize: 9, lineHeight: 11, fontWeight: "600", color: Theme.complianceStageDocsFg },
  editDisabled: { fontSize: 9, lineHeight: 12, fontWeight: "500", color: Theme.textMuted },
  savedChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    minHeight: 30,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: Theme.complianceVerifiedPillBorder,
    backgroundColor: Theme.complianceStageSuccessBg,
  },
  savedBody: { flex: 1, minWidth: 0, gap: 1 },
  savedValue: { fontSize: 10, fontWeight: "700", letterSpacing: 0.3, color: Theme.textPrimaryDark },
  savedTag: { flexDirection: "row", alignItems: "center", gap: 2 },
  savedTagText: { fontSize: 8, fontWeight: "700", color: Theme.complianceStageSuccessFg },
});
