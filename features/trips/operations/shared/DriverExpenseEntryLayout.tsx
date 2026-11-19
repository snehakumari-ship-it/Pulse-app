import Feather from "@expo/vector-icons/Feather";
import { LinearGradient } from "expo-linear-gradient";
import { StatusBar } from "expo-status-bar";
import type { ComponentProps, ReactNode } from "react";
import { createContext, useCallback, useContext, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type NativeSyntheticEvent,
  type TextInputFocusEventData,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import Layout from "@/constants/Layout";
import Theme from "@/constants/Theme";
import Typography from "@/constants/Typography";
import { getDriverThemeColors } from "@/contexts/DriverThemeContext";
import { useKeyboardVisible } from "@/lib/hooks/useKeyboardVisible";

import { ExpenseBillScanBanner } from "./ExpenseBillScanBanner";
import { OpsEntryBodyPhotoSlot } from "./OpsEntryBodyPhotoSlot";
import { ExpenseReceiptIcon } from "./ExpenseReceiptIcon";
import {
  driverOpsEntryStyles as ops,
} from "./driverOpsEntry.styles";
import type { BillScanState } from "./expenseBillScan.types";

const FOOTER_HEIGHT = 68;
const CANVAS = "#F5F7FA";
const ACCENT = Theme.driverEmeraldDark;
const HERO_ART_SIZE = 72;
const HEADER_GRADIENT = [
  Theme.driverMintHeaderTop,
  Theme.driverMintHeaderMid,
  Theme.cardWhite,
] as const;

type ScrollAssistContextValue = {
  scrollToInput: (event: NativeSyntheticEvent<TextInputFocusEventData>) => void;
};

const ScrollAssistContext = createContext<ScrollAssistContextValue | null>(null);

export type DriverExpenseCategory = "fuel" | "toll" | "other";

type CategoryConfig = {
  icon: ComponentProps<typeof Feather>["name"];
  kicker: string;
  hint: string;
};

const CATEGORY: Record<DriverExpenseCategory, CategoryConfig> = {
  fuel: {
    icon: "droplet",
    kicker: "Fuel expense",
    hint: "Log fuel you paid out of pocket for fleet reimbursement.",
  },
  toll: {
    icon: "map-pin",
    kicker: "Toll expense",
    hint: "Log toll or FASTag costs you paid during this trip.",
  },
  other: {
    icon: "plus-circle",
    kicker: "Other expense",
    hint: "Parking, loading, detention, and other trip costs.",
  },
};

type AttachmentProps = {
  uri: string | null;
  busy?: boolean;
  onAttach: () => void;
  onRemove?: () => void;
  label?: string;
};

type Props = {
  category: DriverExpenseCategory;
  title: string;
  subtitle: string;
  isEditing: boolean;
  saving: boolean;
  onBack: () => void;
  onSave: () => void;
  saveDisabled?: boolean;
  skipLabel?: string;
  hint?: string | null;
  syncHint?: string | null;
  billScan?: BillScanState | null;
  onApplyBillScan?: () => void;
  onDismissBillScan?: () => void;
  onReviewBillScan?: () => void;
  attachment?: AttachmentProps;
  /** Column heading above the amount control. Defaults to "Amount". */
  amountLabel?: string;
  amountSlot?: ReactNode;
  children: ReactNode;
};

export function DriverExpenseEntryLayout({
  category,
  title,
  subtitle,
  isEditing,
  saving,
  onBack,
  onSave,
  saveDisabled = false,
  skipLabel = "Cancel",
  hint,
  syncHint,
  billScan,
  onApplyBillScan,
  onDismissBillScan,
  onReviewBillScan,
  attachment,
  amountLabel = "Amount",
  amountSlot,
  children,
}: Props) {
  const insets = useSafeAreaInsets();
  const colors = getDriverThemeColors("light");
  const meta = CATEGORY[category];
  const [previewOpen, setPreviewOpen] = useState(false);
  const hasAttachment = !!attachment?.uri?.trim();
  const scanActive = billScan?.phase === "preparing" || billScan?.phase === "analyzing";
  const scrollRef = useRef<ScrollView>(null);
  const { keyboardVisible, keyboardHeight } = useKeyboardVisible();

  const scrollToInput = useCallback((event: NativeSyntheticEvent<TextInputFocusEventData>) => {
    const target = event.nativeEvent.target;
    if (target == null) return;
    requestAnimationFrame(() => {
      scrollRef.current?.scrollResponderScrollNativeHandleToKeyboard(
        target,
        FOOTER_HEIGHT + 20,
        true,
      );
    });
  }, []);

  const scrollPaddingBottom =
    FOOTER_HEIGHT +
    18 +
    (keyboardVisible
      ? Platform.OS === "ios"
        ? 10
        : Math.max(keyboardHeight, 220) + 10
      : insets.bottom);

  return (
    <KeyboardAvoidingView
      style={[styles.screen, { backgroundColor: Theme.cardWhite }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      enabled={Platform.OS !== "web"}
    >
      <StatusBar style="dark" />
      <View style={styles.body}>
        <LinearGradient
          colors={HEADER_GRADIENT}
          locations={[0, 0.55, 1]}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={[ops.header, styles.header, { paddingTop: insets.top + 6 }]}
        >
          <View style={styles.heroLayout}>
            <View style={styles.heroMain}>
              <View style={styles.heroRow}>
                <Pressable
                  style={({ pressed }) => [styles.backCircle, pressed && styles.backCirclePressed]}
                  onPress={onBack}
                  hitSlop={6}
                  accessibilityRole="button"
                  accessibilityLabel={`Back from ${meta.kicker.toLowerCase()}`}
                >
                  <Feather name="arrow-left" size={18} color={Theme.driverMintHeaderInk} />
                </Pressable>
                <View style={styles.heroCopy}>
                  <Text style={styles.heroTitle} numberOfLines={1}>
                    {title}
                  </Text>
                </View>
              </View>

              <View style={styles.routeChip}>
                <View style={styles.routeDot}>
                  <Feather name="navigation" size={9} color={Theme.cardWhite} />
                </View>
                <Text style={styles.routeChipText} numberOfLines={1}>
                  {subtitle}
                </Text>
              </View>
            </View>

            <View style={styles.heroArt} pointerEvents="none">
              <ExpenseReceiptIcon size={HERO_ART_SIZE} />
            </View>
          </View>
          <Text style={styles.heroHint} numberOfLines={2}>
            {meta.hint}
          </Text>
        </LinearGradient>

        <Modal
          visible={previewOpen && hasAttachment}
          animationType="fade"
          transparent
          onRequestClose={() => setPreviewOpen(false)}
        >
          <Pressable style={styles.previewBackdrop} onPress={() => setPreviewOpen(false)}>
            {attachment?.uri ? (
              <Pressable onPress={() => setPreviewOpen(false)} style={styles.previewImageWrap}>
                <Image
                  source={{ uri: attachment.uri }}
                  style={styles.previewImage}
                  resizeMode="contain"
                />
              </Pressable>
            ) : null}
          </Pressable>
        </Modal>

        <View style={styles.sheet}>
          <ScrollView
            ref={scrollRef}
            style={styles.scroll}
            contentContainerStyle={[styles.sheetContent, { paddingBottom: scrollPaddingBottom }]}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
            automaticallyAdjustKeyboardInsets={Platform.OS === "ios"}
            showsVerticalScrollIndicator={false}
          >
            <ScrollAssistContext.Provider value={{ scrollToInput }}>
              {attachment || amountSlot ? (
                <View style={styles.topCard}>
                  <View style={styles.topRow}>
                    {attachment ? (
                      <View style={styles.receiptCol}>
                        <View style={styles.colLabelRow}>
                          <Feather name="camera" size={10} color={Theme.textMuted} />
                          <Text style={styles.colLabel}>Receipt</Text>
                        </View>
                        <OpsEntryBodyPhotoSlot
                          uri={attachment.uri ?? null}
                          title={attachment.label ?? "Bill photo"}
                          emptyTitle={attachment.label ?? "Bill photo"}
                          hint={
                            billScan?.phase === "confirm"
                              ? "Review detected fields below"
                              : "Tap to enlarge"
                          }
                          emptyHint="Photo auto-fills"
                          scanning={!!scanActive}
                          busy={attachment.busy || saving}
                          scanLabel="AI scan"
                          compact
                          fieldSized
                          embedded
                          onAttach={attachment.onAttach}
                          onPress={hasAttachment ? () => setPreviewOpen(true) : undefined}
                          onRetake={attachment.onAttach}
                          onRemove={attachment.onRemove}
                        />
                      </View>
                    ) : null}
                    {attachment && amountSlot ? <View style={styles.vDivider} /> : null}
                    {amountSlot ? (
                      <View style={styles.amountCol}>
                        <View style={styles.colLabelRow}>
                          <Feather name="credit-card" size={10} color={Theme.textMuted} />
                          <Text style={styles.colLabel}>{amountLabel}</Text>
                        </View>
                        <View style={styles.amountBody}>{amountSlot}</View>
                      </View>
                    ) : null}
                  </View>
                </View>
              ) : null}

              {billScan && billScan.phase !== "idle" ? (
                <ExpenseBillScanBanner
                  scan={billScan}
                  onApplyPending={onApplyBillScan}
                  onDismissPending={onDismissBillScan}
                  onReviewOcr={onReviewBillScan}
                />
              ) : null}
              {children}
            </ScrollAssistContext.Provider>

            {hint ? (
              <View style={[styles.notice, { backgroundColor: colors.emeraldMuted }]}>
                <Feather name="info" size={12} color={ACCENT} />
                <Text style={[styles.noticeText, { color: ACCENT }]}>{hint}</Text>
              </View>
            ) : null}
            {syncHint ? <Text style={styles.syncHint}>{syncHint}</Text> : null}
          </ScrollView>

          <View
            style={[
              styles.footerBar,
              {
                paddingBottom: keyboardVisible ? 10 : insets.bottom + 12,
              },
            ]}
          >
            <Pressable style={styles.skipBtn} onPress={onBack} disabled={saving}>
              <Text style={styles.skipText}>{skipLabel}</Text>
            </Pressable>
            <Pressable
              style={[styles.saveBtn, (saving || saveDisabled) && { opacity: 0.45 }]}
              onPress={onSave}
              disabled={saving || saveDisabled}
              accessibilityState={{ disabled: saving || saveDisabled }}
            >
              {saving ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.saveText}>
                  {isEditing ? "Update expense" : "Save expense"}
                </Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

export function DriverExpenseSection({
  title,
  children,
  fill,
}: {
  title?: string;
  children: ReactNode;
  fill?: boolean;
}) {
  return (
    <View style={[styles.sectionCard, fill && styles.sectionFill]}>
      {title ? <Text style={styles.sectionTitle}>{title}</Text> : null}
      <View style={[styles.sectionBody, fill && styles.sectionBodyFill]}>{children}</View>
    </View>
  );
}

export function DriverExpenseFieldLabel({ children }: { children: string }) {
  return <Text style={styles.fieldLabel}>{children}</Text>;
}

/** Compact field label: name in ink, "(optional)" muted, one line. */
export function DriverExpenseOptionalLabel({ children }: { children: string }) {
  return (
    <Text style={styles.optLabel} numberOfLines={1}>
      {children}
      <Text style={styles.optLabelHint}> (optional)</Text>
    </Text>
  );
}

export function DriverExpenseFieldDivider() {
  return <View style={styles.fieldDivider} />;
}

export function DriverExpenseTextInput(
  props: React.ComponentProps<typeof TextInput> & { multiline?: boolean },
) {
  const colors = getDriverThemeColors("light");
  const scrollAssist = useContext(ScrollAssistContext);
  const { onFocus, ...rest } = props;

  return (
    <TextInput
      {...rest}
      placeholderTextColor={colors.placeholder}
      onFocus={(event) => {
        scrollAssist?.scrollToInput(
          event as unknown as NativeSyntheticEvent<TextInputFocusEventData>,
        );
        onFocus?.(event);
      }}
      style={[
        styles.input,
        props.multiline && styles.inputMultiline,
        {
          color: colors.text,
          backgroundColor: CANVAS,
          borderColor: Theme.driverEmeraldBorderSoft,
        },
        props.style,
      ]}
    />
  );
}

const cardShadow = Platform.select({
  ios: {
    shadowColor: "#0f172a",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
  },
  android: { elevation: 2 },
  default: {},
});

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { flex: 1, minHeight: 0 },
  header: {
    paddingBottom: 14,
    gap: 8,
  },
  backCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: Theme.driverMintRouteBorder,
    backgroundColor: Theme.cardWhite,
    ...Platform.select({
      ios: {
        shadowColor: Theme.driverMintHeaderTitle,
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.06,
        shadowRadius: 2,
      },
      android: { elevation: 1 },
      default: {},
    }),
  },
  backCirclePressed: {
    opacity: 0.8,
    transform: [{ scale: 0.96 }],
  },
  heroRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    overflow: "visible",
  },
  heroCopy: {
    flex: 1,
    minWidth: 0,
    gap: 1,
    paddingRight: 4,
  },
  heroLayout: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  heroMain: {
    flex: 1,
    minWidth: 0,
    gap: 10,
  },
  heroArt: {
    flexShrink: 0,
    width: HERO_ART_SIZE,
    height: HERO_ART_SIZE,
    alignItems: "center",
    justifyContent: "center",
  },
  heroTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: Theme.driverMintHeaderTitle,
    letterSpacing: -0.4,
  },
  routeChip: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    maxWidth: "100%",
    paddingLeft: 5,
    paddingRight: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: Theme.driverMintRouteBorder,
    backgroundColor: Theme.cardWhite,
    ...Platform.select({
      ios: {
        shadowColor: Theme.driverMintHeaderTitle,
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.06,
        shadowRadius: 2,
      },
      android: { elevation: 1 },
      default: {},
    }),
  },
  routeDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: Theme.driverMintHeaderInk,
    alignItems: "center",
    justifyContent: "center",
  },
  routeChipText: {
    flexShrink: 1,
    fontSize: 11,
    fontWeight: "500",
    color: Theme.driverMintRouteText,
  },
  heroHint: {
    fontSize: 11,
    fontWeight: "500",
    lineHeight: 14,
    color: Theme.driverMintHeaderHint,
  },
  sheet: {
    flex: 1,
    minHeight: 0,
    backgroundColor: Theme.driverEmeraldWash,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    overflow: "hidden",
  },
  sheetContent: {
    paddingHorizontal: Layout.screenPaddingHorizontal,
    paddingTop: 12,
    gap: 10,
  },
  scroll: { flex: 1, minHeight: 0 },
  topCard: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 12,
    ...cardShadow,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "stretch",
  },
  receiptCol: {
    flex: 1,
    minWidth: 0,
    gap: 6,
  },
  amountCol: {
    flex: 1,
    minWidth: 0,
    gap: 6,
    justifyContent: "flex-start",
  },
  amountBody: {
    minWidth: 0,
    alignSelf: "stretch",
  },
  vDivider: {
    width: StyleSheet.hairlineWidth,
    backgroundColor: Theme.driverEmeraldBorderSoft,
    marginHorizontal: 10,
  },
  colLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    height: 12,
  },
  colLabel: {
    ...Typography.headerTitle,
    fontSize: 9,
    lineHeight: 12,
    letterSpacing: 0.7,
    fontWeight: "700",
    textTransform: "uppercase",
    color: Theme.textMuted,
  },
  sectionCard: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 12,
    gap: 10,
    ...cardShadow,
  },
  sectionTitle: {
    ...Typography.headerTitle,
    fontSize: 10,
    letterSpacing: 0.7,
    fontWeight: "700",
    textTransform: "uppercase",
    color: Theme.textMuted,
  },
  sectionBody: {
    gap: 12,
  },
  sectionFill: { flex: 1, minHeight: 0 },
  sectionBodyFill: { flex: 1, justifyContent: "center" },
  fieldDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Theme.driverEmeraldBorderSoft,
  },
  fieldLabel: {
    ...Typography.headerTitle,
    fontSize: 10,
    letterSpacing: 0.5,
    marginBottom: 6,
    fontWeight: "700",
    color: Theme.textMuted,
  },
  optLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: Theme.textPrimaryDark,
    marginBottom: 6,
  },
  optLabelHint: {
    fontWeight: "400",
    color: Theme.textMuted,
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    fontWeight: "500",
    minHeight: 42,
    lineHeight: 18,
  },
  inputMultiline: {
    minHeight: 72,
    textAlignVertical: "top",
    paddingTop: 10,
  },
  notice: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    padding: 10,
    borderRadius: 12,
  },
  noticeText: {
    flex: 1,
    fontSize: 11,
    fontWeight: "600",
    lineHeight: 15,
  },
  syncHint: {
    fontSize: 10,
    fontWeight: "500",
    textAlign: "center",
    color: Theme.textMuted,
  },
  footerBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: Layout.screenPaddingHorizontal,
    paddingTop: 10,
    backgroundColor: "#fff",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Theme.driverEmeraldBorderSoft,
  },
  skipBtn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
    borderRadius: 12,
    backgroundColor: CANVAS,
  },
  skipText: {
    fontSize: 13,
    fontWeight: "700",
    color: Theme.textMuted,
  },
  saveBtn: {
    flex: 1.6,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
    borderRadius: 12,
    backgroundColor: ACCENT,
  },
  saveText: {
    fontSize: 13,
    fontWeight: "800",
    color: "#fff",
  },
  previewBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.92)",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  },
  previewImageWrap: {
    width: "100%",
    height: "80%",
    alignItems: "center",
    justifyContent: "center",
  },
  previewImage: {
    width: "100%",
    height: "100%",
  },
});
