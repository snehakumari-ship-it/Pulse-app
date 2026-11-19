import { CenteredLoadingView } from "@/components/CenteredLoadingView";
import { DetailPageLayout } from "@/components/DetailPageLayout";
import { LedgerSettlementPctDock } from "@/components/ledger/LedgerSettlementPctDock";
import { ledgerPaymentModeVisual } from "@/components/ledger/ledgerPaymentVisuals";
import { PaymentModeLogo } from "@/components/ledger/paymentModeLogos";
import { SmartInput } from "@/components/mobile-input";
import Theme from "@/constants/Theme";
import { useAuth } from "@/contexts/AuthContext";
import { getDcoSelfReceivableForTrip } from "@/features/dco-self/services/dcoSelfReceivable.service";
import { CollectCoinsIcon } from "@/features/drivers/components/CollectCoinsIcon";
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
import { ROUTES } from "@/lib/routes";
import { showAppAlert } from "@/lib/appAlert";
import { useDriverOperatingModeQuery } from "@/lib/queries/useDriverOperatingModeQuery";
import { useSafeBack } from "@/lib/useSafeBack";
import { ArrowLeft, Banknote, Hash } from "lucide-react-native";
import { useQueryClient } from "@tanstack/react-query";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
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

const HEADER_GRADIENT = [
  Theme.driverMintHeaderTop,
  Theme.driverMintHeaderMid,
  Theme.payMintPage,
] as const;
const FOREST = Theme.driverMintHeaderInk;

const CAPTURE_MODES = PAYMENT_MODES.filter((mode) =>
  ["CASH", "UPI", "BANK", "CHEQUE"].includes(mode.id),
);

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function newCaptureAttemptId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
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
  const [focusedField, setFocusedField] = useState<"reference" | "paidOn" | null>(null);
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
  const [tagOpen, setTagOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [recorded, setRecorded] = useState<{ title: string; message: string } | null>(null);
  // Same id for retries of one attempt; rotated after a successful save.
  const attemptIdRef = useRef(newCaptureAttemptId());

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

  const kicker =
    lane === "marketplace"
      ? "Pulse Exchange"
      : lane === "fleet"
        ? "Trip commission"
        : "Shipper · Client";

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
        attemptId: attemptIdRef.current,
      });
      if (error) {
        showAppAlert("Could not capture payment", error.message);
        return;
      }
      attemptIdRef.current = newCaptureAttemptId();
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

  const screenTitle = lane === "fleet" ? "Collect commission" : "Collect payment";

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      enabled={Platform.OS !== "web"}
    >
      <StatusBar style="dark" />
      <LinearGradient
        colors={HEADER_GRADIENT}
        locations={[0, 0.55, 1]}
        style={[styles.header, { paddingTop: insets.top + 10 }]}
      >
        <Pressable
          onPress={onBack}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={({ pressed }) => [styles.backCircle, pressed && styles.backCirclePressed]}
        >
          <ArrowLeft size={18} color={FOREST} strokeWidth={2.4} />
        </Pressable>
        <View style={styles.headerCopy}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {screenTitle}
          </Text>
          <Text style={styles.headerKicker} numberOfLines={1}>
            {kicker}
          </Text>
        </View>
        <View style={styles.headerArt} pointerEvents="none">
          <CollectCoinsIcon size={52} />
        </View>
      </LinearGradient>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.hero}>
          {needsPartyTag ? (
            <Text style={styles.heroLabel}>
              Tag a shipper or middleman on this trip before collecting.
            </Text>
          ) : (
            <Text style={styles.heroLabel}>
              {lane === "fleet" ? `Commission from ${partyName}` : `Revenue from ${partyName}`}
            </Text>
          )}
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
            heroAccentColor={FOREST}
            placeholder="0"
            required={false}
            disabled={submitting}
            validation={{
              min: 0,
              max: dueHint > 0 ? dueHint : 100000000,
            }}
          />
          <Text style={styles.heroHint} numberOfLines={2}>
            {partyName} · {tripDisplay}
            {dueHint > 0 ? ` · due ${inr(dueHint)}` : ""}
          </Text>
          <LedgerSettlementPctDock
            dueTotalInr={dueHint}
            amountStr={amount}
            onAmountChange={setAmount}
            accentColor={FOREST}
            variant="mint"
            compact
          />
        </View>

        <View style={styles.card}>
          <View style={styles.sectionHead}>
            <View style={styles.sectionIcon}>
              <Banknote size={15} color={FOREST} strokeWidth={2.2} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.sectionTitle}>Payment mode</Text>
              <Text style={styles.sectionHint}>How this money moved</Text>
            </View>
          </View>
          <View style={styles.modeRow}>
            {CAPTURE_MODES.map((item) => {
              const selected = modeId === item.id;
              const label = ledgerPaymentModeVisual(item.id).shortLabel;
              return (
                <Pressable
                  key={item.id}
                  onPress={() => {
                    if (!submitting) setModeId(item.id);
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={label}
                  style={({ pressed }) => [
                    styles.modeTile,
                    selected && styles.modeTileSelected,
                    pressed && styles.modeTilePressed,
                  ]}
                >
                  <View style={styles.modeLogo}>
                    <PaymentModeLogo modeId={item.id} size={18} />
                  </View>
                  <Text
                    style={[styles.modeLabel, selected && styles.modeLabelSelected]}
                    numberOfLines={1}
                  >
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.card}>
          <View style={styles.sectionHead}>
            <View style={styles.sectionIcon}>
              <Hash size={15} color={FOREST} strokeWidth={2.2} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.sectionTitle}>Reference / UTR</Text>
              <Text style={styles.sectionHint}>
                {isCash ? "Optional for cash" : "NEFT / UPI / bank transaction reference"}
              </Text>
            </View>
          </View>
          <TextInput
            style={[styles.input, focusedField === "reference" && styles.inputFocused]}
            value={reference}
            onChangeText={setReference}
            onFocus={() => setFocusedField("reference")}
            onBlur={() => setFocusedField(null)}
            placeholder="UTR / reference"
            placeholderTextColor={Theme.textMuted}
            autoCapitalize="characters"
            editable={!submitting}
          />
          <Text style={styles.dateLabel}>Paid on</Text>
          <TextInput
            style={[styles.input, focusedField === "paidOn" && styles.inputFocused]}
            value={paidOn}
            onChangeText={setPaidOn}
            onFocus={() => setFocusedField("paidOn")}
            onBlur={() => setFocusedField(null)}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={Theme.textMuted}
            editable={!submitting}
          />
        </View>

        {needsPartyTag ? (
          <TouchableOpacity
            style={styles.tagBtn}
            onPress={() => setTagOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="Tag party"
          >
            <Text style={styles.tagBtnText}>Tag party first</Text>
          </TouchableOpacity>
        ) : null}
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

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        {lane === "marketplace" ? (
          <Text style={styles.exchangeNote}>
            Pulse Exchange records this as received after the shipper confirms.
          </Text>
        ) : null}
        <View style={styles.footerRow}>
          <TouchableOpacity
            style={styles.cancelBtn}
            onPress={onBack}
            disabled={submitting}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Cancel"
          >
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
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
              <ActivityIndicator size="small" color={Theme.cardWhite} />
            ) : (
              <Text style={styles.submitText} numberOfLines={1}>
                Collect {amountNum > 0 ? inr(Math.min(amountNum, cap || amountNum)) : lane === "fleet" ? "commission" : "payment"}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
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
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: Theme.payMintPage,
  },
  empty: {
    fontSize: 13,
    color: Theme.textMuted,
    paddingTop: 12,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 14,
  },
  backCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Theme.cardWhite,
    borderWidth: 1,
    borderColor: Theme.payCircleBorder,
    shadowColor: Theme.driverMintHeaderTitle,
    shadowOpacity: 0.06,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  backCirclePressed: {
    opacity: 0.85,
    transform: [{ scale: 0.96 }],
  },
  headerCopy: {
    flex: 1,
    minWidth: 0,
    alignItems: "center",
  },
  headerTitle: {
    fontSize: 16,
    lineHeight: 20,
    fontWeight: "800",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    color: Theme.driverMintHeaderTitle,
  },
  headerKicker: {
    marginTop: 2,
    fontSize: 12,
    lineHeight: 15,
    fontWeight: "600",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    color: Theme.payMuted,
  },
  headerArt: {
    width: 52,
    height: 52,
    alignItems: "center",
    justifyContent: "center",
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 16,
    gap: 12,
  },
  hero: {
    backgroundColor: Theme.cardWhite,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Theme.payCardBorder,
    padding: 16,
  },
  heroLabel: {
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    color: Theme.payMuted,
    textAlign: "center",
    marginBottom: 6,
  },
  heroHint: {
    marginTop: 8,
    fontSize: 11,
    fontWeight: "500",
    lineHeight: 15,
    color: Theme.payMuted,
    textAlign: "center",
    alignSelf: "center",
    maxWidth: "92%",
  },
  card: {
    backgroundColor: Theme.cardWhite,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Theme.payCardBorder,
    padding: 16,
  },
  sectionHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 12,
  },
  sectionIcon: {
    width: 30,
    height: 30,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Theme.paySage,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.2,
    color: Theme.payInk,
  },
  sectionHint: {
    marginTop: 1,
    fontSize: 11,
    color: Theme.payMuted,
  },
  modeRow: {
    flexDirection: "row",
    gap: 8,
  },
  modeTile: {
    flex: 1,
    minWidth: 0,
    minHeight: 64,
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "transparent",
    backgroundColor: Theme.payTile,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  modeTileSelected: {
    backgroundColor: FOREST,
    borderColor: FOREST,
  },
  modeTilePressed: {
    opacity: 0.9,
    transform: [{ scale: 0.98 }],
  },
  modeLogo: {
    width: 26,
    height: 26,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    backgroundColor: Theme.cardWhite,
  },
  modeLabel: {
    fontSize: 10,
    lineHeight: 12,
    fontWeight: "700",
    letterSpacing: 0.4,
    textTransform: "uppercase",
    color: Theme.payModeLabel,
  },
  modeLabelSelected: {
    color: Theme.cardWhite,
  },
  input: {
    height: 44,
    borderWidth: 1,
    borderColor: Theme.payInputBorder,
    borderRadius: 12,
    paddingHorizontal: 14,
    fontSize: 14,
    fontWeight: "600",
    color: Theme.payInk,
    backgroundColor: Theme.cardWhite,
  },
  inputFocused: {
    borderColor: FOREST,
  },
  dateLabel: {
    marginTop: 12,
    marginBottom: 6,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    color: Theme.payMuted,
  },
  tagBtn: {
    minHeight: 48,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: FOREST,
    backgroundColor: Theme.paySage,
  },
  tagBtnText: {
    fontSize: 14,
    fontWeight: "700",
    color: FOREST,
  },
  footer: {
    backgroundColor: Theme.cardWhite,
    borderTopWidth: 1,
    borderTopColor: Theme.payFooterBorder,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  exchangeNote: {
    fontSize: 11,
    lineHeight: 15,
    textAlign: "center",
    color: Theme.payMuted,
    marginBottom: 10,
  },
  footerRow: {
    flexDirection: "row",
    gap: 12,
  },
  cancelBtn: {
    flex: 1,
    height: 48,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: Theme.payCancelBorder,
    backgroundColor: Theme.cardWhite,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelText: {
    fontSize: 14,
    fontWeight: "700",
    color: Theme.payCancelInk,
  },
  submit: {
    flex: 1.4,
    height: 48,
    borderRadius: 999,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: FOREST,
  },
  submitDisabled: {
    opacity: 0.5,
  },
  submitText: {
    fontSize: 14,
    fontWeight: "800",
    color: Theme.cardWhite,
  },
});
