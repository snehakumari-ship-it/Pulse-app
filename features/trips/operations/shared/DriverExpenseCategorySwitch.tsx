import { useRouter } from "expo-router";
import { Check, ChevronDown, Plus } from "lucide-react-native";
import { useCallback, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import Theme from "@/constants/Theme";
import { showAppAlert } from "@/lib/appAlert";

import {
  activeDriverExpenseCategoryValue,
  DRIVER_EXPENSE_CATEGORY_OPTIONS,
  navigateDriverExpenseCategory,
  type DriverExpenseCategoryNav,
  type DriverExpenseFormKind,
} from "./driverExpenseCategoryNav.util";
import { DriverChipCheck, driverChipTransition } from "./DriverChipCheck";
import { visualForDriverExpenseCategory } from "./driverExpenseChipVisuals.util";
import type { TripOtherExpenseCategory } from "../types";

type Props = {
  tripId: string;
  formKind: DriverExpenseFormKind;
  otherCategory: TripOtherExpenseCategory | null;
  onOtherCategoryChange: (category: TripOtherExpenseCategory) => void;
  /** Tap the active category again to leave none selected. */
  onClearCategory?: () => void;
  /** In-page category switch (driver unified expense flow). */
  onCategoryNavChange?: (next: DriverExpenseCategoryNav) => void;
  lockCategorySwitch?: boolean;
  /**
   * Editing a saved expense: block switching between fuel / toll / other.
   * Each kind is stored in its own table, so a cross-kind switch would save a
   * NEW row and leave the original active (expense counted twice). Changing
   * the sub-category inside "other" is still allowed (same row).
   */
  lockKindSwitch?: boolean;
};

const FREQUENT: DriverExpenseCategoryNav[] = ["fuel", "toll", "parking"];
const ACTIVE = Theme.driverEmeraldDark;
const MUTED = Theme.textMuted;
const INK = Theme.textPrimaryDark;

export function DriverExpenseCategorySwitch({
  tripId,
  formKind,
  otherCategory,
  onOtherCategoryChange,
  onCategoryNavChange,
  onClearCategory,
  lockCategorySwitch = false,
  lockKindSwitch = false,
}: Props) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const activeValue = activeDriverExpenseCategoryValue(formKind, otherCategory);
  const selected = DRIVER_EXPENSE_CATEGORY_OPTIONS.find((option) => option.value === activeValue) ?? null;

  const apply = useCallback(
    (value: DriverExpenseCategoryNav) => {
      if (lockCategorySwitch) return;
      if (lockKindSwitch) {
        const targetKind: DriverExpenseFormKind =
          value === "fuel" || value === "toll" ? value : "other";
        if (targetKind !== formKind) {
          showAppAlert(
            "Can't change type while editing",
            "Delete this expense and add a new one to change it to a different type.",
          );
          return;
        }
      }

      if (onCategoryNavChange) {
        if (value === "fuel" || value === "toll") {
          if (value !== formKind) onCategoryNavChange(value);
          return;
        }
        onCategoryNavChange(value as TripOtherExpenseCategory);
        onOtherCategoryChange(value as TripOtherExpenseCategory);
        return;
      }

      if (value === "fuel" || value === "toll") {
        navigateDriverExpenseCategory(router, tripId, value, formKind);
        return;
      }
      if (formKind !== "other") {
        navigateDriverExpenseCategory(
          router,
          tripId,
          value as TripOtherExpenseCategory,
          formKind,
        );
        return;
      }
      onOtherCategoryChange(value as TripOtherExpenseCategory);
    },
    [
      formKind,
      lockCategorySwitch,
      lockKindSwitch,
      onCategoryNavChange,
      onOtherCategoryChange,
      router,
      tripId,
    ],
  );

  const select = useCallback(
    (value: DriverExpenseCategoryNav) => {
      if (lockCategorySwitch) return;
      if (value === activeValue) {
        onClearCategory?.();
        return;
      }
      apply(value);
    },
    [activeValue, apply, lockCategorySwitch, onClearCategory],
  );

  const openSheet = useCallback(() => {
    if (lockCategorySwitch) return;
    setOpen(true);
  }, [lockCategorySwitch]);

  return (
    <View style={styles.columns}>
      <View style={styles.col}>
        <Text style={styles.label}>Category</Text>
        <Pressable
          onPress={openSheet}
          disabled={lockCategorySwitch}
          accessibilityRole="button"
          accessibilityLabel={selected ? `Category, ${selected.label}` : "Select category"}
          accessibilityState={{ disabled: lockCategorySwitch, expanded: open }}
          style={[styles.field, lockCategorySwitch && styles.disabled]}
        >
          <Text
            style={[styles.fieldText, !selected && styles.placeholder]}
            numberOfLines={1}
          >
            {selected?.label ?? "Select Category..."}
          </Text>
          <ChevronDown size={16} color={MUTED} strokeWidth={2.2} />
        </Pressable>
      </View>

      <View style={styles.col}>
        <Text style={styles.frequentLabel}>Most frequent</Text>
        <View style={styles.chipRow}>
          {FREQUENT.map((value) => {
            const option = DRIVER_EXPENSE_CATEGORY_OPTIONS.find((item) => item.value === value);
            if (!option) return null;
            const active = option.value === activeValue;
            const Icon = visualForDriverExpenseCategory(option.value).Icon;
            return (
              <Pressable
                key={option.value}
                onPress={() => select(option.value)}
                disabled={lockCategorySwitch}
                accessibilityRole="button"
                accessibilityState={{ selected: active, disabled: lockCategorySwitch }}
                accessibilityLabel={option.label}
                style={({ pressed }) => [
                  styles.chip,
                  driverChipTransition,
                  active && styles.chipActive,
                  pressed && styles.chipPressed,
                  lockCategorySwitch && styles.disabled,
                ]}
              >
                {active ? (
                  <DriverChipCheck />
                ) : (
                  <Icon size={14} color={Theme.driverChipIcon} strokeWidth={2.2} />
                )}
                <Text style={[styles.chipText, active && styles.chipTextActive]} numberOfLines={1}>
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
          <Pressable
            onPress={openSheet}
            disabled={lockCategorySwitch}
            accessibilityRole="button"
            accessibilityLabel="More categories"
            style={({ pressed }) => [
              styles.chip,
              driverChipTransition,
              pressed && styles.chipPressed,
              lockCategorySwitch && styles.disabled,
            ]}
          >
            <Plus size={14} color={Theme.driverChipIcon} strokeWidth={2.4} />
            <Text style={[styles.chipText, styles.chipTextUtility]} numberOfLines={1}>
              More
            </Text>
          </Pressable>
        </View>
      </View>

      <Modal
        visible={open}
        transparent
        animationType="slide"
        onRequestClose={() => setOpen(false)}
      >
        <View style={styles.modal}>
          <Pressable
            style={styles.backdrop}
            onPress={() => setOpen(false)}
            accessibilityLabel="Close category list"
          />
          <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
            <View style={styles.handle} />
            <Text style={styles.sheetTitle}>Select category</Text>
            <ScrollView
              style={styles.list}
              keyboardShouldPersistTaps="handled"
              bounces={false}
            >
              {DRIVER_EXPENSE_CATEGORY_OPTIONS.map((option) => {
                const active = option.value === activeValue;
                const Icon = visualForDriverExpenseCategory(option.value).Icon;
                return (
                  <Pressable
                    key={option.value}
                    onPress={() => {
                      if (option.value !== activeValue) apply(option.value);
                      setOpen(false);
                    }}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    style={[styles.row, active && styles.rowActive]}
                  >
                    <View style={[styles.rowIcon, active && styles.rowIconActive]}>
                      <Icon size={16} color={active ? ACTIVE : MUTED} strokeWidth={2.2} />
                    </View>
                    <Text style={[styles.rowLabel, active && styles.rowLabelActive]} numberOfLines={1}>
                      {option.label}
                    </Text>
                    {active ? <Check size={16} color={ACTIVE} strokeWidth={2.4} /> : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  columns: {
    gap: 14,
  },
  col: {
    gap: 8,
  },
  label: {
    fontSize: 10,
    letterSpacing: 0.7,
    color: MUTED,
    textTransform: "uppercase",
    fontWeight: "700",
  },
  field: {
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Theme.borderInput,
    backgroundColor: Theme.cardWhite,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  fieldText: {
    flex: 1,
    minWidth: 0,
    fontSize: 14,
    fontWeight: "600",
    color: INK,
  },
  placeholder: {
    color: MUTED,
    fontWeight: "500",
  },
  frequentLabel: {
    fontSize: 10,
    letterSpacing: 0.7,
    color: MUTED,
    textTransform: "uppercase",
    fontWeight: "700",
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8,
  },
  chip: {
    flexGrow: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    height: 32,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: Theme.driverChipBg,
  },
  chipActive: {
    backgroundColor: Theme.driverChipSelectedBg,
  },
  chipPressed: {
    transform: [{ scale: 0.98 }],
  },
  chipText: {
    fontSize: 12.5,
    fontWeight: "500",
    color: Theme.text,
  },
  chipTextActive: {
    fontWeight: "600",
    color: Theme.driverChipSelectedInk,
  },
  chipTextUtility: {
    color: Theme.driverChipIcon,
  },
  disabled: {
    opacity: 0.5,
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
    maxHeight: "72%",
    backgroundColor: Theme.cardWhite,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 10,
    paddingHorizontal: 16,
    gap: 8,
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
    color: INK,
    letterSpacing: -0.2,
  },
  list: {
    flexGrow: 0,
  },
  row: {
    minHeight: 48,
    borderRadius: 12,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  rowActive: {
    backgroundColor: Theme.driverEmeraldMuted,
  },
  rowIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Theme.surface,
  },
  rowIconActive: {
    backgroundColor: Theme.cardWhite,
  },
  rowLabel: {
    flex: 1,
    minWidth: 0,
    fontSize: 15,
    fontWeight: "600",
    color: INK,
  },
  rowLabelActive: {
    color: ACTIVE,
  },
});
