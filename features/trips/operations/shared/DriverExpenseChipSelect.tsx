import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  LayoutChangeEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { ChevronDown } from "lucide-react-native";

import Theme from "@/constants/Theme";
import Typography from "@/constants/Typography";

import {
  resolveDriverChipVisual,
  type DriverChipVisual,
} from "./driverExpenseChipVisuals.util";

export type DriverExpenseChipOption<T extends string> = {
  value: T;
  label: string;
  visual?: DriverChipVisual;
};

export type DriverExpenseChipGroup =
  | "other_category"
  | "driver_expense_category"
  | "payment_mode"
  | "payment_owner"
  | "fuel_type"
  | "toll_entry"
  | "generic";

type Props<T extends string> = {
  label: string;
  hint?: string;
  options: ReadonlyArray<DriverExpenseChipOption<T>>;
  value: T | null;
  onChange: (value: T) => void;
  /** Tap the selected chip again to clear it. */
  clearable?: boolean;
  onClear?: () => void;
  /** Equal-width tile columns (2 for categories, 3 for payment). */
  columns?: 2 | 3;
  /** Auto-resolve Lucide icons + tints from value. */
  visualGroup?: DriverExpenseChipGroup;
  /**
   * After a pick, collapse to a single selected summary (Add Trip pattern).
   * Tap summary / Change to expand and pick again. Default on.
   */
  collapseAfterSelect?: boolean;
  /** Locked selection — summary only, no Change. */
  disabled?: boolean;
  /**
   * Visual presentation only.
   * - tiles: compact equal-width icon cells
   * - pills: fleet-app filter chips (default for payment)
   */
  presentation?: "tiles" | "pills";
};

const GRID_GAP = 6;
const PILL_GAP = 6;
/** Driver emerald active (restored brand green). */
const ACTIVE = Theme.driverEmeraldDark;
const ACTIVE_SOFT = Theme.driverEmeraldMuted;
const MUTED = "#64748B";
const INK = "#0F172A";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

function SelectableChip({
  active,
  disabled,
  onPress,
  style,
  children,
  accessibilityLabel,
}: {
  active: boolean;
  disabled?: boolean;
  onPress: () => void;
  style: object | object[];
  children: ReactNode;
  accessibilityLabel?: string;
}) {
  const scale = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <AnimatedPressable
      onPress={onPress}
      onPressIn={() => {
        scale.value = withSpring(0.96, { damping: 18, stiffness: 320 });
      }}
      onPressOut={() => {
        scale.value = withSpring(1, { damping: 16, stiffness: 260 });
      }}
      style={[style, animStyle]}
      accessibilityRole="button"
      accessibilityState={{ selected: active, disabled }}
      accessibilityLabel={accessibilityLabel}
      disabled={disabled}
    >
      {children}
    </AnimatedPressable>
  );
}

/**
 * Compact fleet-style chips — shared by driver and business trip expense entry.
 */
export function DriverExpenseChipSelect<T extends string>({
  label,
  hint,
  options,
  value,
  onChange,
  columns = 3,
  visualGroup = "generic",
  collapseAfterSelect = true,
  disabled = false,
  presentation,
  clearable = false,
  onClear,
}: Props<T>) {
  const mode =
    presentation ??
    (visualGroup === "payment_mode" || visualGroup === "payment_owner"
      ? "pills"
      : "tiles");

  const [expanded, setExpanded] = useState(!collapseAfterSelect);
  const [gridWidth, setGridWidth] = useState(0);

  useEffect(() => {
    if (!collapseAfterSelect) setExpanded(true);
  }, [collapseAfterSelect]);

  const prevValueRef = useRef(value);
  useEffect(() => {
    if (!collapseAfterSelect) return;
    if (prevValueRef.current !== value) {
      prevValueRef.current = value;
      setExpanded(false);
    }
  }, [value, collapseAfterSelect]);

  const selected = useMemo(
    () => options.find((option) => option.value === value) ?? null,
    [options, value],
  );

  const resolveVisual = useCallback(
    (option: DriverExpenseChipOption<T> | null): DriverChipVisual | null => {
      if (!option) return null;
      if (option.visual) return option.visual;
      if (visualGroup === "generic") return null;
      return resolveDriverChipVisual(option.value, visualGroup);
    },
    [visualGroup],
  );

  const handleSelect = useCallback(
    (next: T) => {
      if (disabled) return;
      if (clearable && next === value) {
        onClear?.();
        setExpanded(true);
        return;
      }
      if (collapseAfterSelect) setExpanded(false);
      if (next !== value) onChange(next);
    },
    [clearable, collapseAfterSelect, disabled, onChange, onClear, value],
  );

  const onGridLayout = useCallback((event: LayoutChangeEvent) => {
    const next = Math.round(event.nativeEvent.layout.width);
    setGridWidth((prev) => (prev === next ? prev : next));
  }, []);

  const tileWidth =
    gridWidth > 0
      ? Math.floor((gridWidth - GRID_GAP * (columns - 1)) / columns)
      : undefined;

  const selectedVisual = resolveVisual(selected);
  const SelectedIcon = selectedVisual?.Icon;
  const showCollapsed =
    collapseAfterSelect && selected != null && (disabled || !expanded);

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}

      {showCollapsed ? (
        <SelectableChip
          active
          disabled={disabled}
          onPress={() => {
            if (!disabled) setExpanded(true);
          }}
          style={[styles.summaryRow, disabled && styles.disabled]}
          accessibilityLabel={`${label}: ${selected?.label ?? ""}. Change`}
        >
          <View style={styles.summaryAvatar}>
            {SelectedIcon ? (
              <SelectedIcon size={14} color="#fff" strokeWidth={2.2} />
            ) : (
              <Text style={styles.summaryAvatarText}>
                {(selected?.label ?? "?").slice(0, 1).toUpperCase()}
              </Text>
            )}
          </View>
          <Text style={styles.summaryTitle} numberOfLines={1}>
            {selected?.label ?? "—"}
          </Text>
          {!disabled ? (
            <View style={styles.summaryChange}>
              <Text style={styles.summaryChangeText}>Change</Text>
              <ChevronDown size={12} color={MUTED} strokeWidth={2.4} />
            </View>
          ) : null}
        </SelectableChip>
      ) : mode === "pills" ? (
        <View style={styles.pillRow}>
          {options.map((option) => {
            const active = option.value === value;
            const visual = resolveVisual(option);
            const Icon = visual?.Icon;
            return (
              <SelectableChip
                key={option.value}
                active={active}
                disabled={disabled}
                onPress={() => handleSelect(option.value)}
                style={[
                  styles.pill,
                  active && styles.pillActive,
                  disabled && styles.disabled,
                ]}
              >
                {Icon ? (
                  <Icon
                    size={12}
                    color={active ? "#fff" : MUTED}
                    strokeWidth={2.2}
                  />
                ) : null}
                <Text
                  style={[styles.pillText, active && styles.pillTextActive]}
                  numberOfLines={1}
                >
                  {option.label}
                </Text>
              </SelectableChip>
            );
          })}
        </View>
      ) : (
        <View style={styles.grid} onLayout={onGridLayout}>
          {options.map((option) => {
            const active = option.value === value;
            const visual = resolveVisual(option);
            const Icon = visual?.Icon;

            return (
              <SelectableChip
                key={option.value}
                active={active}
                disabled={disabled}
                onPress={() => handleSelect(option.value)}
                style={[
                  styles.tile,
                  tileWidth != null
                    ? { width: tileWidth }
                    : columns === 2
                      ? styles.tileFallbackHalf
                      : styles.tileFallback,
                  active && styles.tileActive,
                  disabled && styles.disabled,
                ]}
              >
                <View style={[styles.tileAvatar, active && styles.tileAvatarActive]}>
                  {Icon ? (
                    <Icon
                      size={13}
                      color={active ? ACTIVE : MUTED}
                      strokeWidth={2.2}
                    />
                  ) : (
                    <Text style={[styles.tileAvatarText, active && styles.tileAvatarTextActive]}>
                      {option.label.slice(0, 1).toUpperCase()}
                    </Text>
                  )}
                </View>
                <Text
                  style={[styles.tileText, active && styles.tileTextActive]}
                  numberOfLines={1}
                >
                  {option.label}
                </Text>
              </SelectableChip>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 6,
  },
  label: {
    ...Typography.headerTitle,
    fontSize: 10,
    letterSpacing: 0.7,
    color: MUTED,
    textTransform: "uppercase",
    fontWeight: "700",
  },
  hint: {
    fontSize: 11,
    fontWeight: "500",
    color: Theme.textSecondary,
    lineHeight: 14,
    marginTop: -2,
  },
  summaryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 40,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 12,
    backgroundColor: ACTIVE_SOFT,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Theme.driverEmeraldBorderSoft,
  },
  summaryAvatar: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: ACTIVE,
  },
  summaryAvatarText: {
    fontSize: 11,
    fontWeight: "800",
    color: "#fff",
  },
  summaryTitle: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    fontWeight: "700",
    color: INK,
    letterSpacing: -0.15,
  },
  summaryChange: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "#fff",
  },
  summaryChangeText: {
    fontSize: 10,
    fontWeight: "700",
    color: MUTED,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: GRID_GAP,
  },
  pillRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: PILL_GAP,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    minHeight: 32,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "#EEF2F7",
  },
  pillActive: {
    backgroundColor: ACTIVE,
  },
  pillText: {
    fontSize: 11,
    fontWeight: "700",
    color: INK,
    letterSpacing: -0.1,
  },
  pillTextActive: {
    color: "#fff",
  },
  tile: {
    minHeight: 52,
    paddingHorizontal: 4,
    paddingTop: 7,
    paddingBottom: 7,
    borderRadius: 12,
    backgroundColor: "#F5F7FA",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  tileFallback: {
    flexGrow: 1,
    flexBasis: "30%",
    maxWidth: "32%",
  },
  tileFallbackHalf: {
    flexGrow: 1,
    flexBasis: "47%",
    maxWidth: "48.5%",
  },
  tileActive: {
    backgroundColor: ACTIVE_SOFT,
    borderWidth: 1,
    borderColor: Theme.driverEmeraldBorderSoft,
  },
  tileAvatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
  },
  tileAvatarActive: {
    backgroundColor: "#fff",
  },
  tileAvatarText: {
    fontSize: 10,
    fontWeight: "800",
    color: MUTED,
  },
  tileAvatarTextActive: {
    color: ACTIVE,
  },
  tileText: {
    fontSize: 10,
    fontWeight: "700",
    color: INK,
    textAlign: "center",
    lineHeight: 12,
    letterSpacing: -0.1,
    width: "100%",
  },
  tileTextActive: {
    color: ACTIVE,
    fontWeight: "800",
  },
  disabled: {
    opacity: 0.5,
  },
});
