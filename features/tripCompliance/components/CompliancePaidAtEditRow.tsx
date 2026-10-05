import Theme from "@/constants/Theme";
import {
  formatComplianceTxnDate,
  normalizeComplianceTransactionDate,
  toComplianceTransactionDateInput,
  validateComplianceTransactionDate,
} from "@/features/tripCompliance/utils/compliancePaymentDate.util";
import { Check, Pencil, X } from "lucide-react-native";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  type TextStyle,
} from "react-native";

/**
 * Paid at row of a posted advance. Same Edit / Save / Cancel pattern as UTR;
 * only `transactions.transaction_date` changes.
 */
export function CompliancePaidAtEditRow({
  paidAt,
  canEdit,
  onSave,
}: {
  paidAt: string | null;
  canEdit: boolean;
  onSave: (transactionDate: string) => Promise<void>;
}) {
  const posted = toComplianceTransactionDateInput(paidAt);
  const [optimistic, setOptimistic] = useState<string | null>(null);
  const current = optimistic ?? posted;
  const display = formatComplianceTxnDate(current || paidAt);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(current);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    setOptimistic(null);
  }, [posted]);

  useEffect(() => {
    if (!editing) setDraft(current);
  }, [current, editing]);

  const startEdit = () => {
    setDraft(current || toComplianceTransactionDateInput(new Date().toISOString()));
    setError(null);
    setEditing(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const cancel = () => {
    if (saving) return;
    setEditing(false);
    setError(null);
  };

  const save = async () => {
    if (saving) return;
    const next = normalizeComplianceTransactionDate(draft);
    const invalid = validateComplianceTransactionDate(next);
    if (invalid) {
      setError(invalid);
      return;
    }
    if (next === current) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(next);
      setOptimistic(next);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't update Paid at. Try again.");
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <View style={styles.row}>
        <Text style={styles.label}>Paid at</Text>
        <View style={styles.valueCol}>
          <View style={styles.valueLine}>
            <Text
              style={[styles.value, !current && styles.valueEmpty]}
              numberOfLines={1}
              selectable
            >
              {display}
            </Text>
            {canEdit ? (
              <TouchableOpacity
                style={styles.editBtn}
                onPress={startEdit}
                activeOpacity={0.75}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel="Edit paid at date"
              >
                <Pencil size={11} color={Theme.textPrimaryDark} strokeWidth={2.2} />
                <Text style={styles.editBtnText}>Edit</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.row, styles.rowEditing]}>
      <Text style={styles.label}>Paid at</Text>
      <View style={styles.valueCol}>
        <View style={styles.editLine}>
          <TextInput
            ref={inputRef}
            value={draft}
            onChangeText={(text) => {
              setDraft(text);
              if (error) setError(null);
            }}
            onSubmitEditing={() => void save()}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={Theme.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            maxLength={10}
            editable={!saving}
            returnKeyType="done"
            keyboardType={Platform.OS === "ios" ? "numbers-and-punctuation" : "default"}
            {...(Platform.OS === "web" ? ({ type: "date" } as object) : null)}
            style={[styles.input, error ? styles.inputError : null] as TextStyle[]}
            accessibilityLabel="Paid at date"
          />
          <TouchableOpacity
            style={[styles.iconBtn, styles.cancelBtn]}
            onPress={cancel}
            disabled={saving}
            activeOpacity={0.75}
            hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
            accessibilityRole="button"
            accessibilityLabel="Cancel paid at edit"
          >
            <X size={14} color={Theme.textPrimaryDark} strokeWidth={2.4} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.iconBtn, styles.saveBtn, saving && styles.saveBtnBusy]}
            onPress={() => void save()}
            disabled={saving}
            activeOpacity={0.85}
            hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
            accessibilityRole="button"
            accessibilityLabel="Save paid at"
          >
            {saving ? (
              <ActivityIndicator size="small" color={Theme.cardWhite} />
            ) : (
              <Check size={14} color={Theme.cardWhite} strokeWidth={2.6} />
            )}
          </TouchableOpacity>
        </View>
        {error ? (
          <Text style={styles.error}>{error}</Text>
        ) : (
          <Text style={styles.hint}>Only the date changes — amount, mode and UTR stay as posted.</Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  rowEditing: { backgroundColor: Theme.compliancePageBg },
  label: {
    width: 128,
    flexShrink: 0,
    fontSize: 8,
    fontWeight: "600",
    letterSpacing: 0.3,
    textTransform: "uppercase",
    color: Theme.textMuted,
    paddingTop: 4,
  },
  valueCol: { flex: 1, minWidth: 0, alignItems: "flex-end", gap: 4 },
  valueLine: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 8,
    minWidth: 0,
    maxWidth: "100%",
  },
  value: {
    flexShrink: 1,
    minWidth: 0,
    textAlign: "right",
    fontSize: 11,
    fontWeight: "600",
    color: Theme.textPrimaryDark,
    lineHeight: 15,
  },
  valueEmpty: { color: Theme.textMuted, fontWeight: "500" },
  editBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    height: 24,
    paddingHorizontal: 9,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Theme.complianceTripCardBorder,
    backgroundColor: Theme.cardWhite,
  },
  editBtnText: { fontSize: 10, fontWeight: "700", color: Theme.textPrimaryDark },
  editLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    width: "100%",
    maxWidth: 280,
  },
  input: {
    flex: 1,
    minWidth: 0,
    height: 32,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Theme.textPrimaryDark,
    backgroundColor: Theme.cardWhite,
    fontSize: 12,
    fontWeight: "600",
    color: Theme.textPrimaryDark,
    textAlign: "right",
    ...(Platform.OS === "web" ? { outlineStyle: "none" } : null),
  },
  inputError: { borderColor: Theme.complianceStageDocsFg },
  iconBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelBtn: {
    borderWidth: 1,
    borderColor: Theme.complianceTripCardBorder,
    backgroundColor: Theme.cardWhite,
  },
  saveBtn: { backgroundColor: Theme.positive },
  saveBtnBusy: { opacity: 0.75 },
  hint: { fontSize: 9, fontWeight: "500", color: Theme.textMuted, textAlign: "right" },
  error: { fontSize: 9, fontWeight: "600", color: Theme.complianceStageDocsFg, textAlign: "right" },
});
