import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  Banknote,
  CheckCircle2,
  Clock,
  CreditCard,
  PieChart,
  Radio,
  Receipt,
  Settings,
  Slash,
} from "lucide-react-native";
import type { LucideIcon } from "lucide-react-native";

import Theme from "@/constants/Theme";

import type { OperationalPaymentMode } from "../types";

type Method = "cash" | "fastag" | "card" | "credit" | "unknown";
type Status = "paid" | "pending" | "part_paid" | "waived";

type Props = {
  value: OperationalPaymentMode | null;
  onChange: (value: OperationalPaymentMode | null) => void;
};

const METHODS: { value: Method; label: string; Icon: LucideIcon }[] = [
  { value: "cash", label: "Cash", Icon: Banknote },
  { value: "fastag", label: "FASTag", Icon: Radio },
  { value: "card", label: "Card", Icon: CreditCard },
  { value: "credit", label: "Credit", Icon: Receipt },
  { value: "unknown", label: "Other", Icon: Settings },
];

const STATUSES: { value: Status; label: string; Icon: LucideIcon }[] = [
  { value: "paid", label: "Paid", Icon: CheckCircle2 },
  { value: "pending", label: "Pending", Icon: Clock },
  { value: "part_paid", label: "Part-Paid", Icon: PieChart },
  { value: "waived", label: "Waived", Icon: Slash },
];

const ACTIVE = Theme.driverEmeraldDark;

function isMethod(value: OperationalPaymentMode | null): value is Method {
  return value === "cash" || value === "fastag" || value === "card" || value === "credit" || value === "unknown";
}

/**
 * Method is what we store on payment_mode (Other uses the existing unknown value).
 * Pending is the stored status. Paid, part-paid and waived stay selected with the method.
 */
export function DriverExpensePaymentFields({ value, onChange }: Props) {
  const [method, setMethod] = useState<Method | null>(isMethod(value) ? value : null);
  const [status, setStatus] = useState<Status | null>(value === "pending" ? "pending" : null);

  useEffect(() => {
    if (isMethod(value)) setMethod(value);
    if (value === "pending") setStatus("pending");
    if (value == null) {
      setMethod(null);
      setStatus(null);
    }
  }, [value]);

  const selectMethod = (next: Method) => {
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

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>Payment method</Text>
      <View style={styles.row}>
        {METHODS.map((option) => {
          const selected = method === option.value;
          return (
            <Chip
              key={option.value}
              label={option.label}
              Icon={option.Icon}
              selected={selected}
              onPress={() => selectMethod(option.value)}
            />
          );
        })}
      </View>

      <Text style={styles.label}>Status (optional)</Text>
      <View style={styles.row}>
        {STATUSES.map((option) => {
          const selected = status === option.value;
          const iconColor = !selected && option.value === "paid" ? ACTIVE : selected ? Theme.buttonDarkText : Theme.textMuted;
          return (
            <Chip
              key={option.value}
              label={option.label}
              Icon={option.Icon}
              selected={selected}
              iconColor={iconColor}
              onPress={() => selectStatus(option.value)}
            />
          );
        })}
      </View>
    </View>
  );
}

function Chip({
  label,
  Icon,
  selected,
  iconColor,
  onPress,
}: {
  label: string;
  Icon: LucideIcon;
  selected: boolean;
  iconColor?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      style={[styles.chip, selected && styles.chipSelected]}
    >
      <Icon size={11} color={iconColor ?? (selected ? Theme.buttonDarkText : Theme.textMuted)} strokeWidth={2.2} />
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
  wrap: {
    gap: 8,
  },
  label: {
    fontSize: 10,
    letterSpacing: 0.7,
    color: Theme.textMuted,
    textTransform: "uppercase",
    fontWeight: "700",
    marginTop: 2,
  },
  row: {
    width: "100%",
    flexDirection: "row",
    flexWrap: "nowrap",
    alignItems: "center",
    gap: 6,
  },
  chip: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    minHeight: 36,
    paddingHorizontal: 2,
    borderRadius: 999,
    backgroundColor: Theme.liquidPillBg,
  },
  chipSelected: {
    backgroundColor: ACTIVE,
  },
  chipText: {
    flexShrink: 1,
    fontSize: 10,
    fontWeight: "700",
    color: Theme.textPrimaryDark,
    letterSpacing: -0.3,
  },
  chipTextSelected: {
    color: Theme.buttonDarkText,
  },
});
