import { CenteredLoadingView } from "@/components/CenteredLoadingView";
import { DocumentDateCalendar } from "@/components/DocumentDateCalendar";
import { DetailPageLayout } from "@/components/DetailPageLayout";
import { SETTLEMENT_PCTS } from "@/components/ledger/LedgerSettlementPctDock";
import {
  LedgerProtocolStripModeTile,
  ledgerPaymentModeVisual,
} from "@/components/ledger/ledgerPaymentVisuals";
import { SmartInput } from "@/components/mobile-input";
import Theme from "@/constants/Theme";
import { useAuth } from "@/contexts/AuthContext";
import { getDcoSelfReceivableForTrip } from "@/features/dco-self/services/dcoSelfReceivable.service";
import { DriverCaptureConfirmModal } from "@/features/drivers/components/DriverCaptureConfirmModal";
import { DriverCollectFromSheet } from "@/features/drivers/components/DriverCollectFromSheet";
import { captureDriverTripPayment } from "@/features/drivers/services/driverCapturePayment.service";
import * as driversService from "@/features/drivers/services/drivers.service";
import {
  driverCaptureLaneForTrip,
  parseDriverCaptureLane,
} from "@/features/drivers/utils/driverCapturePayment.util";
import {
  buildDriverTripNumberMap,
  getDriverTripDisplayNumber,
} from "@/features/driver/utils/driverTripSequence.util";
import {
  isTripTaggedToParty,
  tripReceivablePartyName,
} from "@/features/drivers/utils/driverPartyReceivables.util";
import * as tripsService from "@/features/trips/services/trips.service";
import { formatLedgerAmountInput } from "@/lib/format";
import { PAYMENT_MODES } from "@/lib/paymentModes";
import { queryKeys } from "@/lib/queryKeys";
import { useDriverOperatingModeQuery } from "@/lib/queries/useDriverOperatingModeQuery";
import { ROUTES } from "@/lib/routes";
import { showAppAlert } from "@/lib/appAlert";
import { useSafeBack } from "@/lib/useSafeBack";
import {
  WebOverlayPortal,
  resolveWebOverlayHost,
  webFixedFill,
} from "@/lib/webOverlayPortal";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Calendar, ChevronDown, ChevronLeft, Pencil } from "lucide-react-native";
import { useQueryClient } from "@tanstack/react-query";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Rect } from "react-native-svg";

const CAPTURE_MODES = PAYMENT_MODES.filter((mode) =>
  ["CASH", "UPI", "BANK", "CHEQUE"].includes(mode.id),
);

function MoneyNotes() {
  return (
    <Svg width={78} height={56} viewBox="0 0 78 56">
      <Rect x="16" y="8" width="54" height="34" rx="6" fill={Theme.driverEmeraldWash} stroke={Theme.driverEmerald} strokeWidth="1.6" transform="rotate(-8 43 25)" />
      <Rect x="8" y="16" width="54" height="34" rx="6" fill={Theme.cardWhite} stroke={Theme.driverCtaFill} strokeWidth="1.6" />
      <Rect x="22" y="26" width="26" height="14" rx="7" fill="none" stroke={Theme.driverEmerald} strokeWidth="1.4" />
    </Svg>
  );
}

function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseISODate(value: string): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(`${value}T12:00:00`);
  return new Date();
}

function todayISO(): string {
  return toISODate(new Date());
}

function CapturePaidOnField({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (iso: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<View>(null);
  const maxDate = todayISO();
  const close = () => setOpen(false);
  const webHost =
    Platform.OS === "web"
      ? resolveWebOverlayHost(anchorRef.current as unknown as HTMLElement | null)
      : null;

  return (
    <View ref={anchorRef}>
      <Pressable
        style={styles.dateField}
        disabled={disabled}
        onPress={() => {
          if (!disabled) setOpen(true);
        }}
        accessibilityRole="button"
        accessibilityLabel="Choose calendar date"
        accessibilityState={{ expanded: open, disabled: !!disabled }}
      >
        <Calendar size={16} color={Theme.textMuted} strokeWidth={2} />
        <Text style={styles.dateInput}>{value || "YYYY-MM-DD"}</Text>
        <ChevronDown
          size={16}
          color={Theme.textMuted}
          strokeWidth={2}
          style={{ transform: [{ rotate: open ? "180deg" : "0deg" }] }}
        />
      </Pressable>

      {open && Platform.OS === "web" ? (
        <WebOverlayPortal host={webHost}>
          <View style={[styles.dateOverlay, webFixedFill]}>
            <Pressable
              style={styles.dateDismiss}
              onPress={close}
              accessibilityLabel="Close date picker"
            />
            <View style={styles.datePopover}>
              <DocumentDateCalendar
                selectedIso={value}
                maxDate={maxDate}
                onSelect={(iso) => {
                  onChange(iso);
                  close();
                }}
              />
            </View>
          </View>
        </WebOverlayPortal>
      ) : null}

      {open && Platform.OS === "android" ? (
        <DateTimePicker
          value={parseISODate(value)}
          mode="date"
          display="default"
          maximumDate={parseISODate(maxDate)}
          onChange={(event, date) => {
            setOpen(false);
            if (event.type === "set" && date) onChange(toISODate(date));
          }}
        />
      ) : null}

      {Platform.OS === "ios" ? (
        <Modal visible={open} transparent animationType="slide" onRequestClose={close}>
          <Pressable style={styles.dateSheetBackdrop} onPress={close}>
            <View style={styles.dateSheet} onStartShouldSetResponder={() => true}>
              <View style={styles.dateSheetHeader}>
                <Text style={styles.dateSheetTitle}>Calendar date</Text>
                <Pressable onPress={close} hitSlop={10} accessibilityRole="button">
                  <Text style={styles.dateSheetDone}>Done</Text>
                </Pressable>
              </View>
              <DateTimePicker
                value={parseISODate(value)}
                mode="date"
                display="spinner"
                maximumDate={parseISODate(maxDate)}
                onChange={(_, date) => {
                  if (date) onChange(toISODate(date));
                }}
              />
            </View>
          </Pressable>
        </Modal>
      ) : null}
    </View>
  );
}

function inr(n: number): string {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

function firstParam(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return String(raw ?? "").trim();
}

export default function DriverCapturePaymentScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const onBack = useSafeBack(ROUTES.driverWalletSelf());
  const { profile } = useAuth();
  const {
    canManageDcoSelfBook,
    canManageIndieBook,
    canTagOfflineParty,
    modeLoading,
  } = useDriverOperatingModeQuery();
  const params = useLocalSearchParams<{
    tripId?: string;
    due?: string;
    lane?: string;
    partyName?: string;
    mode?: string;
    reference?: string;
  }>();

  const tripId = firstParam(params.tripId);
  const dueHint = Math.max(0, Math.round(Number(firstParam(params.due)) || 0));
  const partyHint = firstParam(params.partyName);
  const modeHint = firstParam(params.mode).toUpperCase();
  const referenceHint = firstParam(params.reference);

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [trip, setTrip] = useState<tripsService.TripRow | null>(null);
  const [driverId, setDriverId] = useState<string | null>(null);
  const [isFleetLinked, setIsFleetLinked] = useState(false);
  const [selfReceivableId, setSelfReceivableId] = useState<string | null>(null);
  const [indieReceivableId, setIndieReceivableId] = useState<string | null>(null);
  const [amount, setAmount] = useState(
    dueHint > 0 ? formatLedgerAmountInput(dueHint) : "",
  );
  const [modeId, setModeId] = useState(
    CAPTURE_MODES.some((m) => m.id === modeHint) ? modeHint : "UPI",
  );
  const [reference, setReference] = useState(referenceHint);
  const [paidOn, setPaidOn] = useState(todayISO());
  const [amountEditorOpen, setAmountEditorOpen] = useState(false);
  const [modeRowWidth, setModeRowWidth] = useState(0);
  const [tagOpen, setTagOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [recorded, setRecorded] = useState<{ title: string; message: string } | null>(null);

  const load = useCallback(async () => {
    // Resolve operating mode before choosing Self / indie / employer / exchange path.
    if (modeLoading) return;
    if (!tripId || !profile?.uid) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [tripRes, driversRes] = await Promise.all([
        tripsService.getAccessibleTripById(tripId),
        driversService.getLinkedDriversForCurrentUser(profile.uid),
      ]);
      const nextTrip = tripRes.trip;
      setTrip(nextTrip);
      const drivers = driversRes.drivers ?? [];
      const match =
        drivers.find((row) => row.id === nextTrip?.driver_id) ??
        drivers.find(
          (row) =>
            String(row.organization_id ?? "") === String(nextTrip?.organization_id ?? "") &&
            !row.left_at,
        ) ??
        drivers[0] ??
        null;
      setDriverId(nextTrip?.driver_id ?? match?.id ?? null);
      const tripOrg = String(nextTrip?.organization_id ?? "").trim();
      setIsFleetLinked(
        !!tripOrg &&
          drivers.some((row) => {
            if (String(row.organization_id ?? "").trim() !== tripOrg) return false;
            if (row.tracking_only === true) return false;
            return driversService.isActiveFleetRelationshipDriver(row);
          }),
      );
      // Mutual exclusion: DCO Self XOR indie book; never both.
      if (nextTrip?.id && canManageDcoSelfBook) {
        const found = await getDcoSelfReceivableForTrip(nextTrip.id);
        setSelfReceivableId(found.receivable?.id ?? null);
        setIndieReceivableId(null);
      } else if (nextTrip?.id && canManageIndieBook) {
        const { getDriverIndieReceivableForTrip } = await import(
          "@/features/driver-indie/services/driverIndieReceivable.service"
        );
        const found = await getDriverIndieReceivableForTrip(nextTrip.id);
        setIndieReceivableId(found.receivable?.id ?? null);
        setSelfReceivableId(null);
      } else {
        setSelfReceivableId(null);
        setIndieReceivableId(null);
      }
    } finally {
      setLoading(false);
    }
  }, [canManageDcoSelfBook, canManageIndieBook, modeLoading, profile?.uid, tripId]);

  useEffect(() => {
    void load();
  }, [load]);

  const lane =
    parseDriverCaptureLane(firstParam(params.lane)) ??
    (trip ? driverCaptureLaneForTrip(trip, isFleetLinked) : "shipper");
  const tripNumbers = useMemo(
    () => (trip ? buildDriverTripNumberMap([trip]) : {}),
    [trip],
  );
  const tripDisplay = trip ? getDriverTripDisplayNumber(trip, tripNumbers) : "Trip";
  const taggedParty = trip && isTripTaggedToParty(trip);
  const partyName =
    lane === "marketplace"
      ? partyHint || "Pulse Exchange"
      : lane === "fleet"
        ? partyHint ||
          String(trip?.organization_name ?? "").trim() ||
          "Fleet"
        : taggedParty
          ? tripReceivablePartyName(trip)
          : partyHint || (trip ? tripReceivablePartyName(trip) : "Party");
  const useSelfBook = canManageDcoSelfBook && lane === "shipper";
  const useIndieBook = canManageIndieBook && !canManageDcoSelfBook && lane === "shipper";
  // A notes tag is enough to collect. The receivable is opened on submit.
  const needsPartyTag =
    canTagOfflineParty &&
    lane === "shipper" &&
    !!trip &&
    !isTripTaggedToParty(trip);
  const amountNum = Math.round(Number(String(amount).replace(/,/g, "")) || 0);
  const activePct =
    dueHint > 0
      ? SETTLEMENT_PCTS.find((pct) => Math.round((dueHint * pct) / 100) === amountNum) ?? null
      : null;
  const cap = dueHint > 0 ? dueHint : amountNum;
  const isCash = modeId === "CASH";
  const canSubmit =
    !!trip &&
    (useSelfBook || useIndieBook || !!driverId) &&
    !needsPartyTag &&
    amountNum > 0 &&
    (dueHint <= 0 || amountNum <= dueHint) &&
    (isCash || reference.trim().length > 0) &&
    !submitting;

  const submit = useCallback(async () => {
    if (!trip || !canSubmit) return;
    setSubmitting(true);
    try {
      const { error } = await captureDriverTripPayment({
        trip,
        amount: amountNum,
        paymentModeId: modeId,
        reference,
        paidOn,
        lane,
        book: useSelfBook
          ? "dco_self"
          : useIndieBook
            ? "driver_indie"
            : "employer",
        partyName,
        receivableId: useSelfBook
          ? selfReceivableId
          : useIndieBook
            ? indieReceivableId
            : null,
        driverId: driverId ?? "",
        createdBy: profile?.uid ?? null,
        tripDisplay,
      });
      if (error) {
        showAppAlert("Could not capture payment", error.message);
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ["q", "trips"] });
      await queryClient.invalidateQueries({ queryKey: queryKeys.trips.detail(trip.id) });
      setRecorded({
        title: lane === "marketplace" ? "Sent for confirmation" : "Payment recorded",
        message:
          lane === "marketplace"
            ? "The shipper confirms it in Exchange. It counts as received after that."
            : `${tripDisplay} · ${inr(amountNum)} from ${partyName} is saved.`,
      });
    } finally {
      setSubmitting(false);
    }
  }, [
    amountNum,
    canSubmit,
    driverId,
    partyName,
    indieReceivableId,
    lane,
    modeId,
    paidOn,
    profile?.uid,
    queryClient,
    reference,
    selfReceivableId,
    trip,
    tripDisplay,
    useIndieBook,
    useSelfBook,
  ]);

  if (modeLoading || loading) {
    return <CenteredLoadingView message="Loading…" color={Theme.primary} />;
  }

  if (!tripId || !trip) {
    return (
      <DetailPageLayout title="Collect payment" onBack={onBack}>
        <Text style={styles.empty}>This trip is not available.</Text>
      </DetailPageLayout>
    );
  }

  const collectLabel =
    amountNum > 0
      ? `Collect ${inr(Math.min(amountNum, cap || amountNum))}`
      : lane === "fleet"
        ? "Collect commission"
        : "Collect payment";

  return (
    <View style={styles.screen}>
      <LinearGradient
        colors={[Theme.driverEmeraldWash, Theme.driverEmeraldWash]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={[styles.headerBand, { paddingTop: insets.top + 12 }]}
      >
        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={styles.backBtn}
        >
          <ChevronLeft size={18} color={Theme.textPrimary} strokeWidth={2.4} />
        </Pressable>
      </LinearGradient>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingBottom: insets.bottom + 28,
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.hero}>
          <Text style={styles.heroLabel}>
            {needsPartyTag
              ? "Tag a shipper before collecting"
              : lane === "fleet"
                ? `Commission from ${partyName}`
                : `Revenue from ${partyName}`}
          </Text>
          <Text style={styles.heroAmount}>₹ {Math.max(0, amountNum).toLocaleString("en-IN")}</Text>
          <Pressable
            onPress={() => setAmountEditorOpen((open) => !open)}
            accessibilityRole="button"
            accessibilityLabel="Edit amount"
            style={styles.editRow}
          >
            <Text style={styles.editText}>Edit</Text>
            <Pencil size={12} color={Theme.driverEmerald} strokeWidth={2.4} />
          </Pressable>
          {amountEditorOpen ? (
            <SmartInput
              type="currency"
              value={amountNum}
              onChange={(_, numeric) => {
                setAmount(formatLedgerAmountInput(numeric));
              }}
              label="Amount received"
              context={`${partyName} · ${tripDisplay}${dueHint > 0 ? ` · due ${inr(dueHint)}` : ""}`}
              submitLabel="Apply"
              variant="hero"
              density="compact"
              heroAccentColor={Theme.driverEmerald}
              placeholder="0"
              required={false}
              disabled={submitting}
              validation={{
                min: 0,
                max: dueHint > 0 ? dueHint : 100000000,
              }}
            />
          ) : null}
          <View style={styles.moneyArt} pointerEvents="none">
            <MoneyNotes />
          </View>
        </View>

        <Text style={styles.blockTitle}>Settlement</Text>
        <View style={styles.pctGrid}>
          {SETTLEMENT_PCTS.map((pct) => {
            const selected = activePct === pct;
            return (
              <Pressable
                key={pct}
                onPress={() => {
                  if (submitting || dueHint <= 0) return;
                  setAmount(formatLedgerAmountInput(Math.round((dueHint * pct) / 100)));
                }}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                style={[styles.pctChip, selected && styles.pctChipOn]}
              >
                <Text style={[styles.pctText, selected && styles.pctTextOn]}>{pct}%</Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.blockTitle}>Payment mode</Text>
        <Text style={styles.blockHint}>How this money moved</Text>
        <View
          style={styles.modeRow}
          onLayout={(event) => setModeRowWidth(event.nativeEvent.layout.width)}
        >
          {CAPTURE_MODES.map((item) => {
            const tileWidth =
              modeRowWidth > 0 ? (modeRowWidth - 8 * (CAPTURE_MODES.length - 1)) / CAPTURE_MODES.length : undefined;
            return (
              <LedgerProtocolStripModeTile
                key={item.id}
                modeId={item.id}
                label={ledgerPaymentModeVisual(item.id).shortLabel}
                selected={modeId === item.id}
                variant="compact"
                width={tileWidth}
                onPress={() => {
                  if (!submitting) setModeId(item.id);
                }}
              />
            );
          })}
        </View>

        <Text style={styles.blockTitle}>Details rows</Text>
        <Text style={styles.fieldLabel}>UTR / Reference</Text>
        <TextInput
          style={styles.input}
          value={reference}
          onChangeText={setReference}
          placeholder="UTR / reference"
          placeholderTextColor={Theme.textMuted}
          autoCapitalize="characters"
          editable={!submitting}
        />
        <Text style={styles.fieldLabel}>Calendar date</Text>
        <CapturePaidOnField value={paidOn} onChange={setPaidOn} disabled={submitting} />

        {lane === "marketplace" ? (
          <Text style={styles.exchangeNote}>
            Pulse Exchange records this as received after the shipper confirms.
          </Text>
        ) : null}
        {!isCash ? (
          <Text style={styles.exchangeNote}>A UPI or bank reference is required before collecting.</Text>
        ) : null}

        {needsPartyTag ? (
          <TouchableOpacity
            style={styles.submit}
            onPress={() => setTagOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="Tag party"
          >
            <Text style={styles.submitText}>Tag party first</Text>
          </TouchableOpacity>
        ) : null}

        <TouchableOpacity
          style={[styles.submit, !canSubmit && styles.submitDisabled]}
          onPress={() => {
            if (canSubmit) setConfirmOpen(true);
          }}
          disabled={!canSubmit}
          activeOpacity={0.88}
          accessibilityRole="button"
          accessibilityLabel="Capture payment"
        >
          {submitting ? (
            <ActivityIndicator size="small" color={Theme.textPrimary} />
          ) : (
            <Text style={styles.submitText}>{collectLabel}</Text>
          )}
        </TouchableOpacity>
      </ScrollView>

      <DriverCollectFromSheet
        visible={tagOpen}
        trip={trip}
        due={dueHint}
        lane="shipper"
        assignerName={partyHint || null}
        onClose={() => setTagOpen(false)}
        onTagged={() => {
          setTagOpen(false);
          void load();
        }}
      />
      <DriverCaptureConfirmModal
        visible={confirmOpen || !!recorded}
        phase={recorded ? "success" : "confirm"}
        amountLabel={inr(Math.min(amountNum, cap || amountNum))}
        partyName={partyName}
        tripDisplay={tripDisplay}
        modeLabel={CAPTURE_MODES.find((mode) => mode.id === modeId)?.name ?? modeId}
        reference={reference}
        paidOn={paidOn}
        confirming={submitting}
        successTitle={recorded?.title ?? "Payment recorded"}
        successMessage={recorded?.message ?? ""}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => void submit()}
        onDone={() => {
          setConfirmOpen(false);
          setRecorded(null);
          if (router.canGoBack()) router.back();
          else onBack();
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: Theme.driverEmeraldWash,
  },
  headerBand: {
    paddingHorizontal: 16,
    paddingBottom: 36,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.72)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.85)",
  },
  scroll: {
    flex: 1,
    marginTop: -20,
  },
  empty: {
    fontSize: 13,
    color: Theme.textMuted,
    paddingTop: 12,
  },
  hero: {
    backgroundColor: Theme.cardWhite,
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Theme.borderLight,
    paddingHorizontal: 18,
    paddingVertical: 16,
    marginBottom: 18,
    overflow: "hidden",
    shadowColor: "#0f172a",
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  heroLabel: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    color: Theme.textMuted,
  },
  heroAmount: {
    marginTop: 6,
    fontSize: 32,
    fontWeight: "900",
    letterSpacing: -0.8,
    color: Theme.textPrimaryDark,
  },
  editRow: {
    marginTop: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-start",
    minHeight: 32,
  },
  editText: {
    fontSize: 13,
    fontWeight: "700",
    color: Theme.driverEmerald,
  },
  moneyArt: {
    position: "absolute",
    right: 8,
    bottom: 8,
  },
  blockTitle: {
    fontSize: 13,
    fontWeight: "800",
    color: Theme.textPrimaryDark,
    marginBottom: 10,
    marginTop: 4,
  },
  pctGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 18,
  },
  pctChip: {
    width: "31%",
    minHeight: 36,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Theme.borderInput,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
  },
  pctChipOn: {
    backgroundColor: Theme.warningMuted,
    borderColor: Theme.driverGold,
  },
  pctText: {
    fontSize: 12,
    fontWeight: "600",
    color: Theme.textPrimary,
  },
  pctTextOn: {
    fontWeight: "800",
    color: Theme.textPrimaryDark,
  },
  blockHint: {
    marginTop: -6,
    marginBottom: 10,
    fontSize: 12,
    fontWeight: "500",
    color: Theme.textMuted,
  },
  modeRow: {
    flexDirection: "row",
    alignItems: "stretch",
    justifyContent: "space-between",
    gap: 8,
    marginBottom: 18,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: Theme.textMuted,
    marginBottom: 6,
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Theme.borderLight,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 13,
    fontWeight: "600",
    color: Theme.textPrimaryDark,
    backgroundColor: Theme.surfaceGray,
    minHeight: 44,
    marginBottom: 14,
  },
  dateField: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Theme.borderLight,
    borderRadius: 12,
    paddingHorizontal: 12,
    minHeight: 44,
    backgroundColor: Theme.cardWhite,
    marginBottom: 16,
  },
  dateInput: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    fontWeight: "700",
    color: Theme.textPrimaryDark,
    paddingVertical: 10,
  },
  dateOverlay: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 20,
  },
  dateDismiss: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(15, 23, 42, 0.32)",
  },
  datePopover: {
    width: "100%",
    maxWidth: 360,
    borderRadius: 16,
    backgroundColor: Theme.cardWhite,
    overflow: "hidden",
    ...Platform.select({
      web: { boxShadow: "0 12px 32px rgba(15,23,42,0.16)" } as object,
      default: {},
    }),
  },
  dateSheetBackdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(15,23,42,0.35)",
  },
  dateSheet: {
    backgroundColor: Theme.cardWhite,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingBottom: 24,
  },
  dateSheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.borderLight,
  },
  dateSheetTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: Theme.textPrimaryDark,
  },
  dateSheetDone: {
    fontSize: 15,
    fontWeight: "700",
    color: Theme.driverCtaFill,
  },
  exchangeNote: {
    fontSize: 11,
    color: Theme.textMuted,
    marginBottom: 12,
    lineHeight: 15,
  },
  submit: {
    minHeight: 52,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Theme.cardWhite,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Theme.borderLight,
    marginTop: 8,
    shadowColor: "#0f172a",
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  submitDisabled: {
    opacity: 0.55,
  },
  submitText: {
    fontSize: 15,
    fontWeight: "900",
    color: Theme.textPrimaryDark,
  },
});
