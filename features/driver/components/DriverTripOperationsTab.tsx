import { type Href, useRouter } from "expo-router";
import { Camera, Check, ChevronRight, Folder, Pencil } from "lucide-react-native";
import { useCallback, useMemo } from "react";
import { Image, StyleSheet, Text, TouchableOpacity, View } from "react-native";

import Theme from "@/constants/Theme";
import { useDriverThemeColors } from "@/contexts/DriverThemeContext";
import { tripHistoryDetailStyles as td } from "@/features/driver/tripHistory/tripHistoryDetail.styles";
import type { TripDocumentRow } from "@/features/trips/services/tripDocuments.service";
import type { TripRow } from "@/features/trips/services/trips.service";
import { useGPSDistanceEstimate } from "@/features/trips/verification/GPSDistanceHook";
import {
    useTripVerification,
    useTripVerificationPhotos,
} from "@/features/trips/verification/queries/useTripVerification";
import {
    buildOdometerGpsComparisonHint,
    toVerificationSnapshot,
} from "@/features/trips/verification/selectors/verificationSelectors";
import { computeDistanceDiscrepancy } from "@/features/trips/verification/verification.service";
import { ROUTES } from "@/lib/routes";

type Props = {
  trip: TripRow;
  documents?: TripDocumentRow[];
  documentUrls?: Record<string, string>;
  documentsLoading?: boolean;
  onPreviewDocument?: (documentId: string) => void;
  onOpenSettlement?: () => void;
};

type StepTone = "done" | "active" | "idle";

type VerificationSide = "start" | "end" | "both";

function readingText(km: number | null | undefined): string {
  if (km == null || !Number.isFinite(Number(km))) return "";
  const n = Number(km);
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function ReadingField({
  value,
  active,
  onPress,
  accessibilityLabel,
}: {
  value: string;
  active: boolean;
  onPress?: () => void;
  accessibilityLabel: string;
}) {
  const body = (
    <>
      <Text
        style={[styles.fieldValue, !value && styles.fieldPlaceholder]}
        numberOfLines={1}
      >
        {value || " "}
      </Text>
      <Pencil size={14} color={Theme.driverEmerald} strokeWidth={2.2} />
    </>
  );
  if (!onPress) {
    return (
      <View style={[styles.field, styles.fieldMuted]} accessibilityLabel={accessibilityLabel}>
        {body}
      </View>
    );
  }
  return (
    <TouchableOpacity
      style={[styles.field, active ? styles.fieldActive : styles.fieldMuted]}
      onPress={onPress}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      {body}
    </TouchableOpacity>
  );
}

function isImageDocument(doc: TripDocumentRow): boolean {
  return (
    (doc.mime_type ?? "").startsWith("image/") ||
    /\.(jpe?g|png|webp|gif)$/i.test(doc.file_name || doc.storage_path)
  );
}

export function DriverTripOperationsTab({
  trip,
  documents = [],
  documentUrls = {},
  documentsLoading = false,
  onPreviewDocument,
  onOpenSettlement,
}: Props) {
  const router = useRouter();
  const colors = useDriverThemeColors();

  const openVerification = useCallback(
    (side: VerificationSide) => {
      router.push(ROUTES.tripVerification(trip.id, side) as Href);
    },
    [router, trip.id],
  );

  const verificationQuery = useTripVerification(trip.id);
  const photosQuery = useTripVerificationPhotos(trip.id);
  const snapshot = verificationQuery.data ?? toVerificationSnapshot(trip);
  const hasStartPhoto = (photosQuery.data ?? []).some(
    (doc) => doc.document_type === "odometer_start_photo",
  );
  const hasEndPhoto = (photosQuery.data ?? []).some(
    (doc) => doc.document_type === "odometer_end_photo",
  );
  const attachmentDocs = useMemo(
    () => documents.filter((doc) => !String(doc.document_type).startsWith("odometer_")),
    [documents],
  );
  const hasStart = snapshot.startOdometerKm != null;
  const hasEnd = snapshot.endOdometerKm != null;
  const tripVerified =
    snapshot.state === "business_verified" || snapshot.state === "gps_verified";
  const steps: { label: string; tone: StepTone }[] = [
    { label: "Start capture", tone: hasStart ? "done" : "active" },
    {
      label: "Pending upload",
      tone: hasStart && (hasStartPhoto || hasEndPhoto) ? "done" : hasStart ? "active" : "idle",
    },
    {
      label: "Verifying end KM",
      tone: hasEnd ? "done" : hasStart && (hasStartPhoto || hasEndPhoto) ? "active" : "idle",
    },
    {
      label: "Verify trip",
      tone: tripVerified ? "done" : hasEnd ? "active" : "idle",
    },
  ];
  const gpsEstimate = useGPSDistanceEstimate(trip);

  const tripKm =
    snapshot.odometerDistanceKm ??
    (snapshot.startOdometerKm != null && snapshot.endOdometerKm != null
      ? Math.round((snapshot.endOdometerKm - snapshot.startOdometerKm) * 10) / 10
      : null);
  const gpsDistanceKm = snapshot.gpsDistanceKm ?? gpsEstimate;
  const distanceDiscrepancyKm =
    snapshot.distanceDiscrepancyKm ??
    computeDistanceDiscrepancy(snapshot.odometerDistanceKm, gpsDistanceKm);
  const odometerComparisonHint = buildOdometerGpsComparisonHint({
    startOdometerKm: snapshot.startOdometerKm,
    endOdometerKm: snapshot.endOdometerKm,
    odometerDistanceKm: snapshot.odometerDistanceKm,
    gpsDistanceKm,
    distanceDiscrepancyKm,
  });

  return (
    <View style={styles.wrap}>
      <Text style={[styles.sectionKicker, { color: colors.textMuted }]}>
        Odometer • Start & end
      </Text>
      <View
        style={[
          td.tdTimelineCard,
          styles.card,
          { backgroundColor: colors.surface, borderColor: colors.border },
        ]}
      >
        <Text style={[styles.fieldLabel, { color: colors.text }]}>Start Odometer (KM)</Text>
        <View style={styles.fieldRow}>
          <ReadingField
            value={readingText(snapshot.startOdometerKm)}
            active
            onPress={() => openVerification("start")}
            accessibilityLabel="Edit start odometer"
          />
          <Text style={[styles.joiner, { color: colors.textMuted }]}>→</Text>
          <ReadingField
            value=""
            active={false}
            onPress={() => openVerification("start")}
            accessibilityLabel="Open start odometer"
          />
        </View>

        <Text style={[styles.fieldLabel, { color: colors.text }]}>End Odometer (KM)</Text>
        <View style={styles.fieldRow}>
          <ReadingField
            value={readingText(snapshot.endOdometerKm)}
            active
            onPress={() => openVerification("end")}
            accessibilityLabel="Edit end odometer"
          />
          <Text style={[styles.joiner, { color: colors.textMuted }]}>=</Text>
          <ReadingField
            value={tripKm == null ? "-" : readingText(tripKm)}
            active={false}
            onPress={() => openVerification("both")}
            accessibilityLabel="Open start and end odometer"
          />
        </View>

        <View style={styles.photoRow}>
          <TouchableOpacity
            style={styles.photoBtn}
            onPress={() => openVerification("start")}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Start odometer photo"
          >
            <Camera size={14} color={Theme.driverEmerald} strokeWidth={2.2} />
            <Text style={styles.photoLabel}>Start Photo</Text>
            {hasStartPhoto ? <Check size={14} color={Theme.driverEmerald} strokeWidth={2.6} /> : null}
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.photoBtn}
            onPress={() => openVerification("end")}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="End odometer photo"
          >
            <Camera size={14} color={Theme.driverEmerald} strokeWidth={2.2} />
            <Text style={styles.photoLabel}>End Photo</Text>
            {hasEndPhoto ? <Check size={14} color={Theme.driverEmerald} strokeWidth={2.6} /> : null}
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          onPress={() => openVerification("both")}
          activeOpacity={0.75}
          accessibilityRole="button"
          accessibilityLabel="View verification history"
        >
          <Text style={[styles.historyLink, { color: Theme.textPrimaryDark }]}>
            Tap to view verification history
          </Text>
        </TouchableOpacity>

        {odometerComparisonHint?.hasConflict ? (
          <Text style={[styles.conflictHint, { color: Theme.warning }]} numberOfLines={2}>
            {odometerComparisonHint.text}
          </Text>
        ) : null}
      </View>

      <View style={styles.timeline}>
          {steps.map((step, index) => {
            const last = index === steps.length - 1;
            const dotColor =
              step.tone === "done"
                ? Theme.tripsMint
                : step.tone === "active"
                  ? Theme.driverGold
                  : "transparent";
            return (
              <View key={step.label} style={styles.stepRow}>
                <View style={styles.stepRail}>
                  <View
                    style={[
                      styles.stepDot,
                      {
                        backgroundColor: dotColor,
                        borderColor:
                          step.tone === "idle" ? Theme.textMuted : dotColor,
                      },
                    ]}
                  />
                  {last ? null : (
                    <View
                      style={[
                        styles.stepLine,
                        step.tone === "done" ? styles.stepLineSolid : styles.stepLineDotted,
                        {
                          backgroundColor:
                            step.tone === "done" ? Theme.tripsMint : "transparent",
                          borderColor: Theme.textMuted,
                        },
                      ]}
                    />
                  )}
                </View>
                <Text
                  style={[
                    styles.stepLabel,
                    { color: step.tone === "idle" ? colors.textMuted : colors.text },
                  ]}
                >
                  {step.label}
                </Text>
              </View>
            );
          })}
        </View>

      <View style={styles.docsHeader}>
        <Folder size={16} color={colors.text} strokeWidth={2.2} />
        <Text style={[styles.docsTitle, { color: colors.text }]}>Document attachments</Text>
      </View>
      {documentsLoading ? (
        <Text style={[styles.docsEmpty, { color: colors.textMuted }]}>Loading documents…</Text>
      ) : attachmentDocs.length === 0 ? (
        <Text style={[styles.docsEmpty, { color: colors.textMuted }]}>No documents attached yet.</Text>
      ) : (
        attachmentDocs.map((doc) => {
          const name = doc.file_name || doc.storage_path.split("/").pop() || "Document";
          const previewUrl = documentUrls[doc.id];
          return (
            <View key={doc.id} style={styles.docCard}>
              <View style={styles.docThumb}>
                {isImageDocument(doc) && previewUrl ? (
                  <Image source={{ uri: previewUrl }} style={styles.docImage} resizeMode="cover" />
                ) : (
                  <Folder size={16} color={Theme.driverEmerald} />
                )}
              </View>
              <Text style={[styles.docName, { color: colors.text }]} numberOfLines={1}>
                {name}
              </Text>
              <TouchableOpacity
                style={styles.docAction}
                onPress={() => onPreviewDocument?.(doc.id)}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel={`Preview ${name}`}
              >
                <Text style={styles.docActionText}>Preview</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.docAction}
                onPress={() => onPreviewDocument?.(doc.id)}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel={`Manage ${name}`}
              >
                <Text style={styles.docActionText}>Manage files</Text>
              </TouchableOpacity>
            </View>
          );
        })
      )}

      <TouchableOpacity
        style={[
          td.tdQueryBtn,
          styles.opsHintBtn,
          { backgroundColor: colors.surface, borderColor: colors.border },
        ]}
        activeOpacity={0.85}
        onPress={onOpenSettlement}
        accessibilityRole="button"
        accessibilityLabel="Expense log and reimbursements live on the Settlement tab"
      >
        <Text style={[td.tdQueryBtnText, styles.opsHintText, { color: colors.textMuted }]}>
          Expense log and reimbursements live on the Settlement tab.
        </Text>
        <ChevronRight size={14} color={colors.textMuted} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 0,
  },
  card: {
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginBottom: 8,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: "700",
    marginBottom: 8,
  },
  fieldRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 14,
  },
  field: {
    flex: 1,
    minWidth: 0,
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Theme.borderInput,
    backgroundColor: Theme.cardWhite,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  fieldActive: {
    borderColor: Theme.driverEmeraldBorder,
  },
  fieldMuted: {
    backgroundColor: Theme.surfaceGray,
  },
  fieldValue: {
    flex: 1,
    minWidth: 0,
    fontSize: 15,
    fontWeight: "600",
    color: Theme.textPrimary,
  },
  fieldPlaceholder: {
    color: Theme.textMuted,
  },
  joiner: {
    fontSize: 16,
    fontWeight: "600",
    width: 16,
    textAlign: "center",
  },
  photoRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 2,
  },
  photoBtn: {
    flex: 1,
    minHeight: 46,
    borderRadius: 14,
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: Theme.driverEmerald,
    backgroundColor: Theme.driverEmeraldWash,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 8,
  },
  photoLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: Theme.driverEmerald,
  },
  sectionKicker: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: 8,
    marginTop: 2,
  },
  historyLink: {
    marginTop: 12,
    textAlign: "center",
    fontSize: 12,
    fontWeight: "500",
  },
  timeline: {
    marginTop: 16,
    gap: 0,
  },
  stepRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    minHeight: 28,
    gap: 10,
  },
  stepRail: {
    width: 14,
    alignItems: "center",
  },
  stepDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    marginTop: 2,
  },
  stepLine: {
    width: 2,
    flex: 1,
    minHeight: 14,
    marginTop: 2,
  },
  stepLineSolid: {
    borderWidth: 0,
  },
  stepLineDotted: {
    borderStyle: "dotted",
    borderLeftWidth: 2,
    width: 0,
    backgroundColor: "transparent",
  },
  stepLabel: {
    flex: 1,
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 18,
    paddingBottom: 10,
  },
  docsHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 16,
    marginBottom: 10,
  },
  docsTitle: {
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  docsEmpty: {
    fontSize: 13,
    fontWeight: "500",
    marginBottom: 8,
  },
  docCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: Theme.driverEmeraldDark,
    borderRadius: 16,
    backgroundColor: Theme.cardWhite,
    paddingHorizontal: 10,
    paddingVertical: 10,
    marginBottom: 8,
  },
  docThumb: {
    width: 36,
    height: 44,
    borderRadius: 6,
    overflow: "hidden",
    backgroundColor: Theme.driverEmeraldWash,
    alignItems: "center",
    justifyContent: "center",
  },
  docImage: {
    width: 36,
    height: 44,
  },
  docName: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    fontWeight: "700",
  },
  docAction: {
    borderWidth: 1,
    borderColor: Theme.borderInput,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
    backgroundColor: Theme.cardWhite,
  },
  docActionText: {
    fontSize: 11,
    fontWeight: "700",
    color: Theme.textPrimary,
  },
  conflictHint: {
    marginTop: 8,
    textAlign: "center",
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 16,
  },
  opsHintBtn: {
    marginTop: 16,
    marginBottom: 8,
    paddingHorizontal: 14,
    paddingVertical: 14,
    minHeight: 48,
    borderRadius: 14,
    backgroundColor: Theme.cardWhite,
  },
  opsHintText: {
    flex: 1,
    textAlign: "center",
    fontSize: 11,
    letterSpacing: 0.4,
    lineHeight: 15,
    textTransform: "none",
  },
});
