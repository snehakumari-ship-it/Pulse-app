import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowRight,
  ArrowUpRight,
  ChevronLeft,
  Clock,
  Droplets,
  FileText,
  Gift,
  MoreHorizontal,
  Package,
  PackageMinus,
  ShieldAlert,
  Timer,
  Truck,
  Wallet,
  type LucideIcon,
} from "lucide-react-native";

import { SmartInput } from "@/components/mobile-input";
import {
  OperationalBottomActionBar,
  OperationalButton,
} from "@/components/operational";
import { partyMobileWizardStyles as shell } from "@/components/party/partyMobileWizardStyles";
import Layout from "@/constants/Layout";
import { LedgerSyncPalette } from "@/constants/LedgerSyncPalette";
import Theme from "@/constants/Theme";
import { TripAdjustmentReviewTicket } from "@/features/trips/components/trip-detail/adjustment/TripAdjustmentReviewTicket";
import { ProvisionCnDnImpactTag } from "@/features/trips/components/trip-detail/adjustment/ProvisionCnDnImpactTag";
import {
  buildAdjustmentWizardSteps,
  provisionProtocolChips,
  resolveAdjustmentInitialStepIndex,
  type ProvisionProtocolChip,
  type TripAdjustmentWizardStep,
} from "@/features/trips/components/trip-detail/adjustment/tripAdjustmentFlow.util";
import {
  getAdjustmentReasonOptions,
  type TripAdjustmentImpact,
  type TripAdjustmentType,
} from "@/features/trips/services/tripAdjustments";
import { formatLedgerAmountInput } from "@/lib/format";

export interface TripAdjustmentMobileWizardProps {
  entryContextLabel?: string | null;
  tripCode?: string | null;
  type: TripAdjustmentType;
  onTypeChange: (type: TripAdjustmentType) => void;
  laneLocked?: boolean;
  impact: TripAdjustmentImpact;
  onImpactChange: (impact: TripAdjustmentImpact) => void;
  impactLocked?: boolean;
  amountStr: string;
  onAmountChange: (value: string) => void;
  reason: string;
  onReasonChange: (value: string) => void;
  otherReason: string;
  onOtherReasonChange: (value: string) => void;
  reasonLocked?: boolean;
  reasonBeforeAmount?: boolean;
  isAssetDriverCost?: boolean;
  showProtocolShortcuts?: boolean;
  canSubmit: boolean;
  submitting?: boolean;
  onSubmit: () => void;
  onClose: () => void;
  flowSessionKey?: string;
  reviewBaseAmount?: number;
  reviewRevisedAmount?: number;
  isEditing?: boolean;
}

function parseAmount(raw: string): number {
  const n = Math.round(parseFloat(raw.replace(/,/g, "")) || 0);
  return Number.isFinite(n) ? n : 0;
}

const PAGE_PAD = Layout.screenPaddingHorizontal;
const WIZARD_REVIEW_MAX_WIDTH = 480;

const REASON_VISUAL: Record<string, { icon: LucideIcon; color: string; tint: string }> = {
  "Loading Charges": { icon: Package, color: Theme.primary, tint: "#eff6ff" },
  "Unloading Charges": { icon: PackageMinus, color: "#0f766e", tint: "#ecfdf5" },
  "Late Delivery": { icon: Clock, color: "#d97706", tint: "#fffbeb" },
  "Damages / Missing": { icon: AlertTriangle, color: Theme.teslaRed, tint: "#fff1f2" },
  "Fuel Escalation": { icon: Droplets, color: "#0369a1", tint: "#e0f2fe" },
  Detention: { icon: Timer, color: "#7c3aed", tint: "#f5f3ff" },
  "Pass Debit": { icon: ArrowLeftRight, color: Theme.primary, tint: "#eff6ff" },
  "Damage to cargo": { icon: AlertTriangle, color: Theme.teslaRed, tint: "#fff1f2" },
  "Missing / shortage": { icon: PackageMinus, color: "#b45309", tint: "#fffbeb" },
  "Late delivery": { icon: Clock, color: "#d97706", tint: "#fffbeb" },
  "Policy / safety violation": { icon: ShieldAlert, color: Theme.teslaRed, tint: "#fff1f2" },
  "Advance recovery": { icon: Wallet, color: "#0f766e", tint: "#ecfdf5" },
  "Trip tip": { icon: Gift, color: Theme.darkGreen, tint: "#dcfce7" },
  "Loading / unloading help": { icon: Package, color: Theme.primary, tint: "#eff6ff" },
  "Detention allowance": { icon: Timer, color: "#7c3aed", tint: "#f5f3ff" },
  "Performance bonus": { icon: Gift, color: Theme.darkGreen, tint: "#dcfce7" },
  "Reimbursement top-up": { icon: Wallet, color: "#0369a1", tint: "#e0f2fe" },
  Other: { icon: MoreHorizontal, color: Theme.textMuted, tint: "#f1f5f9" },
};

function reasonVisual(label: string) {
  return (
    REASON_VISUAL[label] ?? {
      icon: FileText,
      color: Theme.primary,
      tint: "#eff6ff",
    }
  );
}

function stepMeta(
  step: TripAdjustmentWizardStep | "otherReason",
  type: TripAdjustmentType,
  isAssetDriverCost?: boolean,
  isEditing?: boolean,
): { title: string; hint?: string } {
  switch (step) {
    case "lane":
      return isAssetDriverCost
        ? {
            title: "Driver trip cost",
            hint: "Adjust what this trip costs for the assigned driver.",
          }
        : {
            title: "Which lane?",
            hint: "Revenue changes the sale; cost changes supplier settlement.",
          };
    case "impact":
      return isAssetDriverCost
        ? {
            title: "Deduct or pay driver?",
            hint: "Deduct (CN) for damage, missing, or late delivery. Pay (DN) for tips or allowances.",
          }
        : {
            title: "Credit or debit?",
            hint:
              type === "revenue"
                ? "CN reduces income · DN increases income"
                : "CN reduces cost · DN increases cost",
          };
    case "protocol":
      return {
        title: "Quick protocol",
        hint: "Pick a standard charge or continue to enter amount manually.",
      };
    case "amount":
      return { title: "Adjustment amount", hint: "Enter the provision amount in rupees." };
    case "reason":
      return isAssetDriverCost
        ? {
            title: "Reason for driver adjustment",
            hint: "Pick the deduction or payment type for payroll and audit.",
          }
        : { title: "Why this adjustment?", hint: "Select the closest reason for audit." };
    case "otherReason":
      return {
        title: "Other reason",
        hint: "Describe the charge or credit in your own words.",
      };
    case "review":
      return isEditing
        ? { title: "Confirm update", hint: "Authorize changes before updating this note." }
        : { title: "Confirm sync", hint: "Authorize this provision to post it to your books." };
    default:
      return { title: "Provision" };
  }
}

function canAdvanceStep(
  step: TripAdjustmentWizardStep | "otherReason",
  props: TripAdjustmentMobileWizardProps,
): boolean {
  switch (step) {
    case "lane":
    case "impact":
    case "protocol":
      return true;
    case "amount":
      return parseAmount(props.amountStr) > 0;
    case "reason":
      return props.reason.trim().length > 0 && props.reason !== "Other";
    case "otherReason":
      return props.otherReason.trim().length > 0;
    case "review":
      return props.canSubmit;
    default:
      return false;
  }
}

export const TripAdjustmentMobileWizard = memo(function TripAdjustmentMobileWizard(
  props: TripAdjustmentMobileWizardProps,
) {
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const isWide = windowWidth >= 680;
  const laneLocked = props.laneLocked === true;
  const impactLocked = props.impactLocked === true;
  const reasonLocked = props.reasonLocked === true;
  const reasonBeforeAmount = props.reasonBeforeAmount === true;
  const showProtocolShortcuts = props.showProtocolShortcuts !== false;

  const steps = useMemo(
    () =>
      buildAdjustmentWizardSteps({
        laneLocked,
        impactLocked,
        reasonLocked,
        showProtocolShortcuts,
        reasonBeforeAmount,
      }),
    [laneLocked, impactLocked, reasonLocked, showProtocolShortcuts, reasonBeforeAmount],
  );

  const [stepIndex, setStepIndex] = useState(() =>
    resolveAdjustmentInitialStepIndex(steps, {
      laneLocked,
      impactLocked,
      reasonLocked,
      reasonBeforeAmount,
    }),
  );
  const [otherReasonMode, setOtherReasonMode] = useState(false);

  const lastSessionKeyRef = useRef(props.flowSessionKey ?? "");
  useEffect(() => {
    const key = props.flowSessionKey ?? "";
    if (key === lastSessionKeyRef.current) return;
    lastSessionKeyRef.current = key;
    setOtherReasonMode(false);
    setStepIndex(
      resolveAdjustmentInitialStepIndex(steps, {
        laneLocked,
        impactLocked,
        reasonLocked,
        reasonBeforeAmount,
      }),
    );
  }, [props.flowSessionKey, steps, laneLocked, impactLocked, reasonLocked, reasonBeforeAmount]);

  const currentStep = steps[stepIndex] ?? "review";
  const effectiveStep =
    currentStep === "reason" && otherReasonMode ? ("otherReason" as const) : currentStep;
  const isAssetDriverCost = props.isAssetDriverCost === true;
  const { title, hint } = stepMeta(effectiveStep, props.type, isAssetDriverCost, props.isEditing);
  const canAdvance = canAdvanceStep(effectiveStep, props);
  const reasonOptions = getAdjustmentReasonOptions({
    type: props.type,
    isAssetDriverCost,
    impact: props.impact,
  });
  const selectedReason =
    props.reason === "Other"
      ? props.otherReason.trim() || "Other"
      : props.reason.trim();
  const amountNum = parseAmount(props.amountStr);
  const accent = props.type === "revenue" ? Theme.primary : "#0f766e";
  const entityTitle = props.isEditing ? "EDIT PROVISION" : "PROVISION ADJUST";

  const handleBack = useCallback(() => {
    if (otherReasonMode) {
      setOtherReasonMode(false);
      return;
    }
    if (stepIndex <= 0) {
      props.onClose();
      return;
    }
    setStepIndex((i) => Math.max(0, i - 1));
  }, [stepIndex, props, otherReasonMode]);

  const handleAdvance = useCallback(() => {
    if (effectiveStep === "review") {
      if (props.canSubmit && !props.submitting) props.onSubmit();
      return;
    }
    if (currentStep === "reason" && props.reason === "Other" && !otherReasonMode) {
      setOtherReasonMode(true);
      return;
    }
    if (!canAdvance) return;
    if (otherReasonMode) setOtherReasonMode(false);
    setStepIndex((i) => Math.min(steps.length - 1, i + 1));
  }, [
    canAdvance,
    currentStep,
    effectiveStep,
    otherReasonMode,
    props,
    steps.length,
  ]);

  const applyProtocolChip = useCallback(
    (chip: ProvisionProtocolChip) => {
      const preset = chip.preset;
      props.onTypeChange(preset.type);
      props.onImpactChange(preset.impact);
      const seed = preset.reasonSeed;
      if ((reasonOptions as readonly string[]).includes(seed)) {
        props.onReasonChange(seed);
        props.onOtherReasonChange("");
      } else {
        props.onReasonChange("Other");
        props.onOtherReasonChange(seed);
      }
      const amountIdx = steps.indexOf("amount");
      setStepIndex(amountIdx >= 0 ? amountIdx : stepIndex);
    },
    [props, reasonOptions, steps, stepIndex],
  );

  const renderLane = () => (
    <View style={styles.choiceCol}>
      <Pressable
        style={[styles.directionCard, props.type === "revenue" && styles.directionCardActiveIn]}
        onPress={() => props.onTypeChange("revenue")}
      >
        <View style={[styles.directionIcon, { backgroundColor: "#ede9fe" }]}>
          <ArrowUpRight size={22} color={Theme.primary} strokeWidth={2.4} />
        </View>
        <View style={styles.laneTextCol}>
          <Text style={styles.laneTitle}>Revenue (Sale)</Text>
          <Text style={styles.laneSub}>Client billing</Text>
        </View>
      </Pressable>
      <Pressable
        style={[styles.directionCard, props.type === "cost" && styles.directionCardActiveOut]}
        onPress={() => props.onTypeChange("cost")}
      >
        <View style={[styles.directionIcon, { backgroundColor: "#ccfbf1" }]}>
          <ArrowDownLeft size={22} color="#0f766e" strokeWidth={2.4} />
        </View>
        <View style={styles.laneTextCol}>
          <Text style={styles.laneTitle}>Cost (Supplier)</Text>
          <Text style={styles.laneSub}>Supplier settlement</Text>
        </View>
      </Pressable>
    </View>
  );

  const renderImpact = () => (
    <View style={styles.choiceCol}>
      <Pressable
        style={[styles.directionCard, props.impact === "minus" && styles.impactCardCn]}
        onPress={() => props.onImpactChange("minus")}
      >
        <View style={[styles.directionIcon, { backgroundColor: "#dcfce7" }]}>
          <ArrowDownLeft size={22} color={Theme.darkGreen} strokeWidth={2.6} />
        </View>
        <View style={styles.laneTextCol}>
          <Text style={styles.laneTitle}>
            {isAssetDriverCost ? "Deduct from driver (CN)" : "Credit (CN)"}
          </Text>
          <ProvisionCnDnImpactTag
            type={props.type}
            impact="minus"
            isAssetDriverCost={isAssetDriverCost}
          />
          {isAssetDriverCost ? (
            <Text style={styles.laneSub}>Damage · missing · late delivery</Text>
          ) : null}
        </View>
      </Pressable>
      <Pressable
        style={[styles.directionCard, props.impact === "plus" && styles.impactCardDn]}
        onPress={() => props.onImpactChange("plus")}
      >
        <View style={[styles.directionIcon, { backgroundColor: "#fee2e2" }]}>
          <ArrowUpRight size={22} color={Theme.teslaRed} strokeWidth={2.6} />
        </View>
        <View style={styles.laneTextCol}>
          <Text style={styles.laneTitle}>
            {isAssetDriverCost ? "Pay driver (DN)" : "Debit (DN)"}
          </Text>
          <ProvisionCnDnImpactTag
            type={props.type}
            impact="plus"
            isAssetDriverCost={isAssetDriverCost}
          />
          {isAssetDriverCost ? (
            <Text style={styles.laneSub}>Tip · bonus · allowance</Text>
          ) : null}
        </View>
      </Pressable>
    </View>
  );

  const renderProtocol = () => (
    <ScrollView
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.captureScroll}
    >
      <View style={styles.captureSectionCard}>
        <View style={styles.captureSectionHead}>
          <View style={[styles.captureSectionIcon, styles.captureSectionIconType]}>
            <Truck size={15} color={Theme.primary} strokeWidth={2.2} />
          </View>
          <View style={styles.captureSectionHeadText}>
            <Text style={styles.captureSectionEyebrow}>Protocol</Text>
            <Text style={styles.captureSectionHint}>What kind of charge is this?</Text>
          </View>
        </View>
        <View style={styles.iconGrid}>
          {provisionProtocolChips(props.type, props.impact).map((chip) => {
            const visual = reasonVisual(chip.label);
            const Icon = visual.icon;
            return (
              <Pressable
                key={chip.label}
                style={styles.typeTile}
                onPress={() => applyProtocolChip(chip)}
              >
                <View style={[styles.typeIconWrap, { backgroundColor: visual.tint }]}>
                  <Icon size={22} color={visual.color} strokeWidth={2.2} />
                </View>
                <Text style={styles.typeTileLabel} numberOfLines={2}>
                  {chip.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Pressable style={styles.protocolSkip} onPress={handleAdvance}>
          <Text style={styles.protocolSkipText}>Enter manually →</Text>
        </Pressable>
      </View>
    </ScrollView>
  );

  const amountHint = isAssetDriverCost
    ? props.impact === "plus"
      ? "Adds to revised driver trip cost (tip or allowance)."
      : "Reduces revised driver trip cost (deduction from salary)."
    : `${props.impact === "plus" ? "Debit note increases" : "Credit note reduces"} ${
        props.type === "revenue" ? "sale" : "supplier cost"
      }.`;

  const renderAmountFullPage = () => (
    <View style={styles.amountFullPage}>
      <View style={[styles.amountTopBar, { paddingTop: insets.top + 4 }]}>
        <Pressable
          style={styles.amountBackBtn}
          onPress={handleBack}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <ChevronLeft size={20} color="#0f172a" strokeWidth={2.5} />
        </Pressable>
        <View style={styles.amountTopBarDetail}>
          <View style={shell.titleRow}>
            <View style={shell.liveDot} />
            <Text style={styles.entityTitleCompact}>{entityTitle}</Text>
          </View>
          {props.entryContextLabel ? (
            <Text style={styles.subtitleCompact} numberOfLines={1}>
              {props.entryContextLabel}
            </Text>
          ) : null}
        </View>
        <View style={styles.amountBackBtn} />
      </View>

      <View style={styles.tripDirectStepBand}>
        <View style={styles.tripDirectProgressRow}>
          {steps.map((id, i) => (
            <View
              key={id}
              style={[
                styles.tripDirectProgressDot,
                i <= stepIndex && styles.tripDirectProgressDotActive,
              ]}
            />
          ))}
        </View>
        <Text style={styles.twoStepFlowLabel}>
          Step {stepIndex + 1} of {steps.length} · Amount
        </Text>
      </View>

      <ScrollView
        style={styles.amountFullPageScroll}
        contentContainerStyle={styles.amountFullPageScrollContent}
        keyboardShouldPersistTaps="always"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.amountHeroCenter}>
          <View style={styles.amountHeroInputWrap}>
            <SmartInput
              type="currency"
              value={amountNum}
              onChange={(_, numeric) => {
                props.onAmountChange(formatLedgerAmountInput(numeric));
              }}
              label="Provision amount"
              submitLabel="Apply"
              variant="hero"
              heroAccentColor={accent}
              placeholder="0"
              required={false}
              validation={{ min: 0, max: 100000000 }}
            />
          </View>
          <Text style={styles.amountMetaHintCentered}>{amountHint}</Text>
        </View>
      </ScrollView>

      <OperationalBottomActionBar>
        <OperationalButton
          intent="bottomSticky"
          label="Continue"
          onPress={handleAdvance}
          disabled={!canAdvance}
          density="high"
          fullWidth
        />
      </OperationalBottomActionBar>
    </View>
  );

  const renderReason = () => (
    <ScrollView
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.captureScroll}
    >
      <View style={styles.captureSectionCard}>
        <View style={styles.captureSectionHead}>
          <View style={[styles.captureSectionIcon, styles.captureSectionIconType]}>
            <FileText size={15} color={Theme.primary} strokeWidth={2.2} />
          </View>
          <View style={styles.captureSectionHeadText}>
            <Text style={styles.captureSectionEyebrow}>Reason</Text>
            <Text style={styles.captureSectionHint}>What kind of adjustment is this?</Text>
          </View>
        </View>
        <View style={styles.iconGrid}>
          {reasonOptions.map((r) => {
            const selected = props.reason === r;
            const visual = reasonVisual(r);
            const Icon = visual.icon;
            return (
              <Pressable
                key={r}
                style={[
                  styles.typeTile,
                  selected && { borderColor: visual.color, backgroundColor: visual.tint },
                ]}
                onPress={() => {
                  props.onReasonChange(r);
                  if (r === "Other") {
                    props.onOtherReasonChange("");
                    setOtherReasonMode(true);
                  } else {
                    props.onOtherReasonChange("");
                    setOtherReasonMode(false);
                  }
                }}
              >
                <View style={styles.typeIconWrap}>
                  <Icon
                    size={22}
                    color={selected ? visual.color : Theme.textMuted}
                    strokeWidth={2.2}
                  />
                </View>
                <Text
                  style={[styles.typeTileLabel, selected && { color: visual.color }]}
                  numberOfLines={2}
                >
                  {r}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      {props.reason === "Other" ? (
        <Pressable style={styles.otherReasonLink} onPress={() => setOtherReasonMode(true)}>
          <Text style={styles.otherReasonLinkText}>
            {props.otherReason.trim()
              ? `Edit: ${props.otherReason.trim()}`
              : "Describe other reason →"}
          </Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );

  const renderOtherReason = () => (
    <ScrollView
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.captureScroll}
    >
      <View style={styles.captureSectionCard}>
        <View style={styles.captureSectionHead}>
          <View style={[styles.captureSectionIcon, styles.captureSectionIconRef]}>
            <MoreHorizontal size={15} color={Theme.primary} strokeWidth={2.2} />
          </View>
          <View style={styles.captureSectionHeadText}>
            <Text style={styles.captureSectionEyebrow}>Other reason</Text>
            <Text style={styles.captureSectionHint}>
              This appears on the provision line and audit trail.
            </Text>
          </View>
        </View>
        <TextInput
          style={styles.captureReferenceInput}
          value={props.otherReason}
          onChangeText={props.onOtherReasonChange}
          placeholder="e.g. Shortage at unloading, rate mismatch…"
          placeholderTextColor={Theme.textMuted}
          maxLength={120}
          multiline
          autoFocus
          textAlignVertical="top"
        />
      </View>
    </ScrollView>
  );

  const renderReview = () => (
    <ScrollView
      showsVerticalScrollIndicator={false}
      contentContainerStyle={[
        styles.reviewScroll,
        isWide && styles.reviewScrollWide,
      ]}
    >
      <View style={styles.reviewColumn}>
        <TripAdjustmentReviewTicket
          type={props.type}
          impact={props.impact}
          amount={amountNum}
          reason={
            selectedReason ||
            (props.type === "revenue" ? "Revenue adjustment" : "Cost adjustment")
          }
          tripCode={props.tripCode}
          baseAmount={props.reviewBaseAmount}
          revisedAmount={props.reviewRevisedAmount}
        />
      </View>
    </ScrollView>
  );

  const body = (() => {
    if (effectiveStep === "otherReason") return renderOtherReason();
    switch (currentStep) {
      case "lane":
        return renderLane();
      case "impact":
        return renderImpact();
      case "protocol":
        return renderProtocol();
      case "amount":
        return null;
      case "reason":
        return renderReason();
      case "review":
        return renderReview();
      default:
        return null;
    }
  })();

  const advanceLabel =
    currentStep === "review"
      ? props.submitting
        ? props.isEditing
          ? "Updating…"
          : "Saving…"
        : props.isEditing
          ? "Save Changes"
          : "Confirm Sync"
      : "Continue";

  if (currentStep === "amount" && !otherReasonMode) {
    return <View style={styles.amountFullPageShell}>{renderAmountFullPage()}</View>;
  }

  return (
    <KeyboardAvoidingView
      style={[shell.root, styles.wizardRoot]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={[shell.root, styles.wizardRoot, { paddingTop: insets.top }]}>
        <View style={[shell.topBar, styles.topBarCompact]}>
          <Pressable style={shell.backBtn} onPress={handleBack} hitSlop={12}>
            <ChevronLeft size={20} color="#0f172a" strokeWidth={2.5} />
          </Pressable>
          <View style={styles.mobileHeaderCenter}>
            <View style={shell.progressRow}>
              {steps.map((id, i) => (
                <View
                  key={id}
                  style={[
                    shell.progressDot,
                    i <= stepIndex && shell.progressDotActive,
                    i <= stepIndex && styles.progressDotActiveCompact,
                  ]}
                />
              ))}
            </View>
          </View>
          <View style={shell.backBtnSpacer} />
        </View>

        <View
          style={[
            shell.body,
            styles.bodyCompact,
            effectiveStep === "review" && styles.bodyReview,
          ]}
        >
          <View
            style={[
              styles.stepHeader,
              effectiveStep === "review" && isWide && styles.stepHeaderReviewWide,
            ]}
          >
            <View style={styles.compactContext}>
              <View style={shell.titleRow}>
                <View style={shell.liveDot} />
                <Text style={styles.entityTitleCompact}>{entityTitle}</Text>
              </View>
              {props.entryContextLabel ? (
                <Text style={styles.subtitleCompact} numberOfLines={2}>
                  {props.entryContextLabel}
                </Text>
              ) : null}
            </View>
            {effectiveStep !== "review" ? (
              <>
                <Text style={[shell.stepTitle, styles.stepTitleCompact]}>{title}</Text>
                {hint ? (
                  <Text style={[shell.stepHint, styles.stepHintCompact]}>{hint}</Text>
                ) : null}
              </>
            ) : (
              <>
                <Text style={[shell.stepTitle, styles.stepTitleCompact]}>{title}</Text>
                {hint ? (
                  <Text style={[shell.stepHint, styles.stepHintCompact]}>{hint}</Text>
                ) : null}
              </>
            )}
          </View>
          {body}
        </View>

        <View
          style={[
            shell.footer,
            styles.footerCompact,
            styles.footerAboveBrowserChrome,
            effectiveStep === "review" && styles.footerReview,
            { paddingBottom: insets.bottom + 12 },
          ]}
        >
          {effectiveStep === "review" ? (
            <View style={styles.footerReviewInner}>
              <Pressable
                style={[
                  styles.confirmSyncBtn,
                  (!props.canSubmit || props.submitting) && styles.confirmSyncBtnDisabled,
                ]}
                onPress={handleAdvance}
                disabled={!props.canSubmit || props.submitting}
              >
                <Text style={styles.confirmSyncBtnText}>{advanceLabel}</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <Pressable
                style={[shell.fab, styles.fabCompact, !canAdvance && shell.fabDisabled]}
                onPress={handleAdvance}
                disabled={!canAdvance}
              >
                <ArrowRight size={20} color="#fff" strokeWidth={2.8} />
              </Pressable>
              <Text style={[shell.footerHint, styles.footerHintCompact]}>{advanceLabel}</Text>
            </>
          )}
        </View>
      </View>
    </KeyboardAvoidingView>
  );
});

const styles = StyleSheet.create({
  wizardRoot: {
    flex: 1,
    width: "100%",
    alignSelf: "stretch",
    minWidth: 0,
  },
  topBarCompact: { paddingHorizontal: PAGE_PAD, paddingBottom: 2 },
  bodyCompact: {
    paddingHorizontal: PAGE_PAD,
    paddingTop: 0,
    flex: 1,
    width: "100%",
    alignSelf: "stretch",
    minWidth: 0,
  },
  footerCompact: { paddingHorizontal: PAGE_PAD, paddingTop: 2 },
  footerAboveBrowserChrome: Platform.select({
    web: {
      flexShrink: 0,
      backgroundColor: "#fff",
    },
    default: {},
  }),
  mobileHeaderCenter: {
    flex: 1,
    minWidth: 0,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  stepHeader: { marginBottom: 10, gap: 4 },
  compactContext: { gap: 2, marginBottom: 4 },
  entityTitleCompact: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.4,
    color: Theme.positive,
    textTransform: "uppercase",
  },
  subtitleCompact: {
    fontSize: 12,
    fontWeight: "600",
    color: Theme.textMuted,
    marginTop: 2,
  },
  stepTitleCompact: { fontSize: 20, letterSpacing: -0.3 },
  stepHintCompact: { fontSize: 12, marginBottom: 0, lineHeight: 17 },
  progressDotActiveCompact: { width: 18, height: 6, borderRadius: 3 },
  fabCompact: { width: 48, height: 48, borderRadius: 24 },
  footerHintCompact: { fontSize: 9 },
  choiceCol: { gap: 8 },
  directionCard: {
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 14,
    padding: 12,
    backgroundColor: "#f8fafc",
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  directionCardActiveIn: {
    borderColor: Theme.primary,
    backgroundColor: "rgba(99,102,241,0.08)",
  },
  directionCardActiveOut: {
    borderColor: "#0f766e",
    backgroundColor: "rgba(15,118,110,0.08)",
  },
  impactCardCn: {
    borderColor: Theme.darkGreen,
    backgroundColor: "rgba(22,163,74,0.08)",
  },
  impactCardDn: {
    borderColor: Theme.teslaRed,
    backgroundColor: "rgba(232,33,39,0.08)",
  },
  directionIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  laneTextCol: { flex: 1, minWidth: 0 },
  laneTitle: { fontSize: 15, fontWeight: "800", color: "#0f172a" },
  laneSub: { fontSize: 12, color: Theme.textMuted, marginTop: 2 },
  captureScroll: {
    paddingBottom: 12,
    gap: 12,
    width: "100%",
    alignSelf: "stretch",
    minWidth: 0,
  },
  captureSectionCard: {
    width: "100%",
    alignSelf: "stretch",
    minWidth: 0,
    backgroundColor: "#fff",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#e6edf5",
    padding: 14,
    gap: 12,
  },
  captureSectionHead: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  captureSectionIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  captureSectionIconType: {
    backgroundColor: "#eff6ff",
  },
  captureSectionIconRef: {
    backgroundColor: "#eff6ff",
  },
  captureSectionHeadText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  captureSectionEyebrow: {
    fontSize: 13,
    fontWeight: "700",
    color: "#0f172a",
    letterSpacing: -0.1,
  },
  captureSectionHint: {
    fontSize: 12,
    fontWeight: "500",
    color: Theme.textMuted,
    lineHeight: 16,
  },
  captureReferenceInput: {
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    fontWeight: "600",
    color: "#0f172a",
    backgroundColor: "#f8fafc",
    width: "100%",
    minWidth: 0,
    minHeight: 120,
  },
  iconGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    width: "100%",
    alignSelf: "stretch",
  },
  typeTile: {
    width: "47%",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 12,
    padding: 8,
    backgroundColor: "#fff",
    alignItems: "center",
    gap: 4,
    minHeight: 68,
  },
  typeIconWrap: {
    minHeight: 28,
    width: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  typeTileLabel: {
    fontSize: 10,
    fontWeight: "700",
    color: Theme.textMuted,
    textAlign: "center",
  },
  protocolSkip: {
    width: "100%",
    paddingVertical: 6,
    alignItems: "center",
  },
  protocolSkipText: {
    fontSize: 12,
    fontWeight: "700",
    color: Theme.primary,
  },
  amountFullPageShell: {
    flex: 1,
    width: "100%",
    alignSelf: "stretch",
    minWidth: 0,
    backgroundColor: Theme.screenBackground,
  },
  amountFullPage: {
    flex: 1,
    width: "100%",
    minWidth: 0,
    backgroundColor: Theme.screenBackground,
  },
  amountFullPageScroll: {
    flex: 1,
    minHeight: 0,
    width: "100%",
    minWidth: 0,
  },
  amountFullPageScrollContent: {
    flexGrow: 1,
    paddingHorizontal: PAGE_PAD,
    paddingTop: 6,
    paddingBottom: 8,
    width: "100%",
    alignSelf: "stretch",
    minWidth: 0,
    gap: 8,
  },
  amountTopBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: PAGE_PAD,
    paddingBottom: 8,
    width: "100%",
    minWidth: 0,
    backgroundColor: Theme.cardWhite,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: LedgerSyncPalette.border,
  },
  amountBackBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Theme.surfaceForm,
  },
  amountTopBarDetail: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  tripDirectStepBand: {
    paddingHorizontal: PAGE_PAD,
    paddingBottom: 8,
    gap: 6,
    alignItems: "center",
  },
  tripDirectProgressRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  tripDirectProgressDot: {
    width: 28,
    height: 4,
    borderRadius: 999,
    backgroundColor: "#e2e8f0",
  },
  tripDirectProgressDotActive: {
    backgroundColor: LedgerSyncPalette.indigo,
  },
  twoStepFlowLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: LedgerSyncPalette.indigo,
    letterSpacing: 0.3,
    marginTop: 2,
  },
  amountHeroCenter: {
    width: "100%",
    alignItems: "center",
    gap: 10,
    alignSelf: "stretch",
    minWidth: 0,
  },
  amountHeroInputWrap: {
    width: "100%",
    alignSelf: "stretch",
    minWidth: 0,
  },
  amountMetaHintCentered: {
    fontSize: 12,
    color: Theme.textMuted,
    textAlign: "center",
    lineHeight: 17,
    paddingHorizontal: 8,
  },
  otherReasonLink: {
    paddingVertical: 10,
    alignItems: "center",
  },
  otherReasonLinkText: {
    fontSize: 13,
    fontWeight: "700",
    color: Theme.primary,
  },
  reviewScroll: {
    paddingBottom: 8,
    width: "100%",
  },
  reviewScrollWide: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 8,
  },
  reviewColumn: {
    width: "100%",
    maxWidth: WIZARD_REVIEW_MAX_WIDTH,
    alignSelf: "center",
  },
  bodyReview: {
    flex: 1,
    minHeight: 0,
    alignItems: "center",
  },
  stepHeaderReviewWide: {
    width: "100%",
    maxWidth: WIZARD_REVIEW_MAX_WIDTH,
    alignSelf: "center",
  },
  footerReview: {
    alignItems: "stretch",
    alignSelf: "stretch",
    width: "100%",
  },
  footerReviewInner: {
    width: "100%",
    maxWidth: WIZARD_REVIEW_MAX_WIDTH,
    alignSelf: "center",
  },
  confirmSyncBtn: {
    alignSelf: "stretch",
    backgroundColor: Theme.primary,
    paddingVertical: 13,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
  },
  confirmSyncBtnDisabled: { opacity: 0.55 },
  confirmSyncBtnText: {
    fontSize: 14,
    fontWeight: "800",
    color: Theme.textOnDark,
    letterSpacing: 0.2,
  },
});
