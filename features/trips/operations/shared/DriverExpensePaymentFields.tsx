import { useEffect, useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  Banknote,
  CircleCheck,
  CircleEllipsis,
  CircleSlash2,
  Clock3,
  Contrast,
  CreditCard,
  HandCoins,
  Nfc,
  PencilLine,
  type LucideIcon,
} from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import Theme from "@/constants/Theme";

import type { OperationalPaymentMode } from "../types";
import { driverChipTransition } from "./DriverChipCheck";
import { DriverExpenseSection } from "./DriverExpenseEntryLayout";

type Method = "cash" | "fastag" | "card" | "credit" | "unknown";
type Status = "paid" | "pending" | "part_paid" | "waived";

type Props = {
  value: OperationalPaymentMode | null;
  onChange: (value: OperationalPaymentMode | null) => void;
  /**
   * Free-text reason for an "Other" payment. There is no payment-detail column,
   * so screens bind this to the expense notes.
   */
  otherDetail?: string;
  onOtherDetailChange?: (text: string) => void;
};

type ChipOption<T> = { value: T; label: string; Icon: LucideIcon; tint: string };

const METHODS: ChipOption<Method>[] = [
  { value: "cash", label: "Cash", Icon: Banknote, tint: Theme.chipIconCash },
  { value: "fastag", label: "FASTag", Icon: Nfc, tint: Theme.chipIconFastag },
  { value: "card", label: "Card", Icon: CreditCard, tint: Theme.chipIconCard },
  { value: "credit", label: "Credit", Icon: HandCoins, tint: Theme.chipIconCredit },
  { value: "unknown", label: "Other", Icon: CircleEllipsis, tint: Theme.chipIconOther },
];

const STATUSES: ChipOption<Status>[] = [
  { value: "paid", label: "Paid", Icon: CircleCheck, tint: Theme.chipIconPaid },
  { value: "pending", label: "Pending", Icon: Clock3, tint: Theme.chipIconPending },
  { value: "part_paid", label: "Part-Paid", Icon: Contrast, tint: Theme.chipIconPartPaid },
  { value: "waived", label: "Waived", Icon: CircleSlash2, tint: Theme.chipIconWaived },
];

const ACTIVE = Theme.driverEmeraldDark;

function isMethod(value: OperationalPaymentMode | null): value is Method {
  return value === "cash" || value === "fastag" || value === "card" || value === "credit" || value === "unknown";
}

/**
 * Method is what we store on payment_mode (Other uses the existing unknown value).
 * Pending is the stored status. Paid, part-paid and waived stay selected with the method.
 */
export function DriverExpensePaymentFields({
  value,
  onChange,
  otherDetail = "",
  onOtherDetailChange,
}: Props) {
  const insets = useSafeAreaInsets();
  const [method, setMethod] = useState<Method | null>(isMethod(value) ? value : null);
  const [status, setStatus] = useState<Status | null>(value === "pending" ? "pending" : null);
  const [otherOpen, setOtherOpen] = useState(false);
  const [draft, setDraft] = useState(otherDetail);
  const canMention = Boolean(onOtherDetailChange);

  useEffect(() => {
    if (isMethod(value)) setMethod(value);
    if (value === "pending") setStatus("pending");
    if (value == null) {
      setMethod(null);
      setStatus(null);
    }
  }, [value]);

  const openOther = () => {
    setDraft(otherDetail);
    setOtherOpen(true);
  };

  const closeOther = (save: boolean) => {
    if (save) onOtherDetailChange?.(draft.trim());
    setOtherOpen(false);
  };

  const selectMethod = (next: Method) => {
    if (next === "unknown" && canMention) {
      if (method !== "unknown") {
        setMethod("unknown");
        onChange("unknown");
      }
      openOther();
      return;
    }
    if (method === next) {
      setMethod(null);
      onChange(status === "pending" ? "pending" : null);
      return;
    }
    setMethod(next);
    onChange(next);
  };

  const selectStatus = (next: Status) => {
    if (status === next) {
      setStatus(null);
      if (value === "pending") onChange(method);
      return;
    }
    setStatus(next);
    if (next === "pending" && method == null) onChange("pending");
    else if (value === "pending" && method) onChange(method);
  };

  const mention = otherDetail.trim();

  return (
    <>
      <DriverExpenseSection title="Payment method">
        <View style={styles.row}>
          {METHODS.map((option) => (
            <Chip
              key={option.value}
              label={option.label}
              Icon={option.Icon}
              tint={option.tint}
              selected={method === option.value}
              onPress={() => selectMethod(option.value)}
            />
          ))}
        </View>
        {canMention && method === "unknown" && mention ? (
          <Pressable
            onPress={openOther}
            accessibilityRole="button"
            accessibilityLabel={`Other payment: ${mention}. Edit`}
            style={({ pressed }) => [styles.mentionLine, pressed && styles.pressed]}
          >
            <PencilLine size={12} color={ACTIVE} strokeWidth={2.2} />
            <Text style={styles.mentionText} numberOfLines={1}>
              {mention}
            </Text>
          </Pressable>
        ) : null}
      </DriverExpenseSection>

      <DriverExpenseSection title="Status (optional)">
        <View style={styles.row}>
          {STATUSES.map((option) => (
            <Chip
              key={option.value}
              label={option.label}
              Icon={option.Icon}
              tint={option.tint}
              selected={status === option.value}
              onPress={() => selectStatus(option.value)}
            />
          ))}
        </View>
      </DriverExpenseSection>

      <Modal
        visible={otherOpen}
        transparent
        animationType="slide"
        onRequestClose={() => closeOther(false)}
      >
        <KeyboardAvoidingView
          style={styles.modal}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <Pressable
            style={styles.backdrop}
            onPress={() => closeOther(false)}
            accessibilityLabel="Close"
          />
          <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
            <View style={styles.handle} />
            <Text style={styles.sheetTitle}>Other</Text>
            <Text style={styles.label}>Mention</Text>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder="How was it paid? e.g. UPI from owner, paid by shipper"
              placeholderTextColor={Theme.textMuted}
              multiline
              autoFocus
              maxLength={240}
              style={styles.mentionBox}
              accessibilityLabel="Mention the payment reason"
            />
            <Pressable
              onPress={() => closeOther(true)}
              accessibilityRole="button"
              style={({ pressed }) => [styles.doneBtn, pressed && styles.pressed]}
            >
              <Text style={styles.doneText}>Done</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

function Chip({
  label,
  Icon,
  tint,
  selected,
  onPress,
}: {
  label: string;
  Icon: LucideIcon;
  tint: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      hitSlop={{ top: 6, bottom: 6 }}
      style={({ pressed }) => [
        styles.chip,
        driverChipTransition,
        selected && styles.chipSelected,
        pressed && styles.chipPressed,
      ]}
    >
      <Icon size={13} strokeWidth={2.3} color={selected ? Theme.driverChipSelectedInk : tint} />
      <Text
        style={[styles.chipText, selected && styles.chipTextSelected]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.85}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  label: {
    fontSize: 10,
    letterSpacing: 0.7,
    color: Theme.textMuted,
    textTransform: "uppercase",
    fontWeight: "700",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  chip: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    gap: 3,
    alignItems: "center",
    justifyContent: "center",
    height: 32,
    paddingHorizontal: 3,
    borderRadius: 999,
    backgroundColor: Theme.driverChipBg,
  },
  chipSelected: {
    backgroundColor: Theme.driverChipSelectedBg,
  },
  chipPressed: {
    transform: [{ scale: 0.98 }],
  },
  chipText: {
    flexShrink: 1,
    fontSize: 12,
    fontWeight: "500",
    color: Theme.text,
  },
  chipTextSelected: {
    fontWeight: "600",
    color: Theme.driverChipSelectedInk,
  },
  mentionLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 32,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: Theme.driverEmeraldMuted,
  },
  mentionText: {
    flex: 1,
    minWidth: 0,
    fontSize: 12,
    fontWeight: "600",
    color: ACTIVE,
  },
  pressed: {
    opacity: 0.82,
  },
  modal: {
    flex: 1,
    justifyContent: "flex-end",
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: Theme.overlayBackdrop,
  },
  sheet: {
    backgroundColor: Theme.cardWhite,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 10,
    paddingHorizontal: 16,
    gap: 10,
  },
  handle: {
    alignSelf: "center",
    width: 36,
    height: 4,
    borderRadius: 999,
    backgroundColor: Theme.borderLight,
    marginBottom: 4,
  },
  sheetTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: Theme.textPrimaryDark,
    letterSpacing: -0.2,
  },
  mentionBox: {
    minHeight: 96,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Theme.borderInput,
    backgroundColor: Theme.cardWhite,
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 12,
    fontSize: 14,
    fontWeight: "500",
    color: Theme.textPrimaryDark,
    textAlignVertical: "top",
  },
  doneBtn: {
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: ACTIVE,
    marginTop: 2,
  },
  doneText: {
    fontSize: 14,
    fontWeight: "700",
    color: Theme.buttonDarkText,
  },
});
