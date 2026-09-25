import { PartyAvatar } from "@/components/PartyAvatar";
import { TripVaultFilePreview } from "@/features/trips/components/trip-detail/TripVaultFilePreview";
import Theme from "@/constants/Theme";
import { rejectDocument, verifyDocument } from "@/features/compliance/services/documents.service";
import {
  guessCompliancePreviewMime,
  signCompliancePreviewUrl,
} from "@/features/tripCompliance/services/complianceDocumentView.service";
import { setTripDocumentVerification } from "@/features/tripCompliance/services/tripComplianceWrite.service";
import {
  COMPLIANCE_DRIVER_DOCUMENT_TYPES,
  COMPLIANCE_VEHICLE_DOCUMENT_TYPES,
  type ComplianceTripSummary,
} from "@/features/tripCompliance/tripCompliance.types";
import {
  complianceTripDisplayId,
  formatComplianceTimestamp,
  complianceEventAt,
  verificationStatusVisual,
} from "@/features/tripCompliance/utils/complianceCardVisual.util";
import {
  deriveComplianceDocumentRows,
  deriveEntityComplianceRows,
  labelForDocType,
  type ComplianceDocRow,
} from "@/features/tripCompliance/utils/complianceDocumentRows.util";
import { complianceReviewDecisionActions } from "@/features/tripCompliance/utils/complianceReviewActions.util";
import { deriveComplianceQueueReadiness } from "@/features/tripCompliance/utils/complianceReadiness.util";
import { alertMessage } from "@/features/tripCompliance/utils/crossPlatformAlert.util";
import { splitHubRouteLocationDisplay } from "@/features/trips/utils/tripLocationDisplay.util";
import { getTripExecutionModel } from "@/features/trips/domain/tripExecutionModel";
import { markVehicleDocumentVerified } from "@/features/vehicles/services/vehicleDocuments.service";
import { formatIndianVehicleNumber } from "@/lib/format";
import { ChevronLeft, ChevronRight, Minus, Plus, RotateCcw } from "lucide-react-native";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";

type DocTab = "trip" | "vehicle" | "driver";

const TABS: { key: DocTab; label: string }[] = [
  { key: "trip", label: "Trip" },
  { key: "vehicle", label: "Vehicle" },
  { key: "driver", label: "Driver" },
];

function rowsForTab(summary: ComplianceTripSummary, tab: DocTab): ComplianceDocRow[] {
  if (tab === "vehicle") return deriveEntityComplianceRows(COMPLIANCE_VEHICLE_DOCUMENT_TYPES, summary.vehicleDocuments);
  if (tab === "driver") return deriveEntityComplianceRows(COMPLIANCE_DRIVER_DOCUMENT_TYPES, summary.driverDocuments);
  return deriveComplianceDocumentRows(summary.documents);
}

function hasFile(row: ComplianceDocRow): boolean {
  return Boolean(row.doc?.storage_path || row.entityDoc?.storage_path);
}

function fittedDocumentSize(
  natural: { width: number; height: number },
  box: { width: number; height: number },
  zoom: number,
): { width: number; height: number } {
  const contain = Math.min(box.width / natural.width, box.height / natural.height);
  const scale = Math.min(contain, 1) * zoom;
  return {
    width: Math.max(1, Math.round(natural.width * scale)),
    height: Math.max(1, Math.round(natural.height * scale)),
  };
}

function OriginalDocumentPreview({
  uri,
  isPdf,
  zoom,
  label,
}: {
  uri: string;
  isPdf: boolean;
  zoom: number;
  label: string;
}) {
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    setNatural(null);
    if (isPdf) return;
    let cancelled = false;
    Image.getSize(
      uri,
      (width, height) => {
        if (!cancelled && width > 0 && height > 0) setNatural({ width, height });
      },
      () => {
        if (!cancelled) setNatural(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [uri, isPdf]);

  const fitted = useMemo(
    () => (natural && box.width > 1 && box.height > 1 ? fittedDocumentSize(natural, box, zoom) : null),
    [natural, box, zoom],
  );
  const display =
    isPdf && box.width > 1 && box.height > 1
      ? { width: Math.max(1, Math.round(box.width * zoom)), height: Math.max(1, Math.round(box.height * zoom)) }
      : fitted ??
        (box.width > 1 && box.height > 1
          ? { width: Math.max(1, Math.round(box.width * zoom)), height: Math.max(1, Math.round(box.height * zoom)) }
          : null);
  const overflows = Boolean(display && (display.width > box.width + 1 || display.height > box.height + 1));

  return (
    <View
      style={styles.stageBody}
      onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        setBox((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
      }}
    >
      {display ? (
        <PreviewScroller box={box} contentWidth={display.width} contentHeight={display.height} overflows={overflows}>
          {isPdf ? (
            <TripVaultFilePreview uri={uri} isPdf style={display} accessibilityLabel={label} />
          ) : (
            <Image
              source={{ uri }}
              style={display}
              resizeMode="contain"
              accessibilityLabel={label}
              onLoad={(event) => {
                const source = event.nativeEvent.source;
                if (source?.width > 0 && source?.height > 0) {
                  setNatural((prev) =>
                    prev?.width === source.width && prev?.height === source.height
                      ? prev
                      : { width: source.width, height: source.height },
                  );
                }
              }}
            />
          )}
        </PreviewScroller>
      ) : null}
    </View>
  );
}

function PreviewScroller({
  box,
  contentWidth,
  contentHeight,
  overflows,
  children,
}: {
  box: { width: number; height: number };
  contentWidth: number;
  contentHeight: number;
  overflows: boolean;
  children: React.ReactNode;
}) {
  if (Platform.OS === "web") {
    return (
      <View style={[styles.stageScroll, Platform.OS === "web" ? ({ overflow: "auto" } as ViewStyle) : null]}>
        <View style={overflows ? { width: contentWidth, height: contentHeight } : [styles.stageScrollCenter, styles.stageFill]}>
          {children}
        </View>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.stageScroll}
      nestedScrollEnabled
      contentContainerStyle={overflows ? styles.stageScrollStart : styles.stageScrollCenter}
    >
      <ScrollView
        horizontal
        nestedScrollEnabled
        style={{ height: Math.max(contentHeight, box.height) }}
        contentContainerStyle={overflows ? styles.stageScrollStart : [styles.stageScrollCenter, { minWidth: box.width }]}
      >
        {children}
      </ScrollView>
    </ScrollView>
  );
}

export function ComplianceDocumentWorkspace({
  summaries,
  organizationId,
  actorId,
  canVerify,
  canViewDocuments,
  onChanged,
  stacked = false,
  style,
  canManageFinance = false,
  onPay,
}: {
  summaries: ComplianceTripSummary[];
  organizationId: string;
  actorId: string | null;
  canVerify: boolean;
  canViewDocuments: boolean;
  onChanged: (tripId: string) => void;
  stacked?: boolean;
  style?: StyleProp<ViewStyle>;
  canManageFinance?: boolean;
  onPay?: (summary: ComplianceTripSummary) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(summaries[0]?.trip.id ?? null);
  const [tab, setTab] = useState<DocTab>("trip");
  const [docIndex, setDocIndex] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewMime, setPreviewMime] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [declineOpen, setDeclineOpen] = useState(false);
  const [declineReason, setDeclineReason] = useState("");

  const summary = summaries.find((item) => item.trip.id === selectedId) ?? summaries[0] ?? null;
  const rows = useMemo(() => (summary ? rowsForTab(summary, tab) : []), [summary, tab]);
  const previewable = useMemo(() => rows.filter(hasFile), [rows]);
  const activeRow = previewable[docIndex] ?? rows[docIndex] ?? null;

  useEffect(() => {
    if (!summaries.some((item) => item.trip.id === selectedId)) {
      setSelectedId(summaries[0]?.trip.id ?? null);
    }
  }, [summaries, selectedId]);

  useEffect(() => {
    setDocIndex(0);
    setZoom(1);
    setDeclineOpen(false);
    setDeclineReason("");
  }, [summary?.trip.id, tab]);

  useEffect(() => {
    const row = previewable[docIndex] ?? null;
    const path = row?.doc?.storage_path ?? row?.entityDoc?.storage_path ?? null;
    if (!row || !path || !canViewDocuments || !organizationId) {
      setPreviewUrl(null);
      setPreviewMime(null);
      setLoadingPreview(false);
      return;
    }
    let cancelled = false;
    setLoadingPreview(true);
    setPreviewUrl(null);
    void signCompliancePreviewUrl({
      storagePath: path,
      source: tab === "trip" ? "trip" : row.entityDoc?.source,
      sourceEntityDocumentId: row.doc?.source_entity_document_id,
      organizationId,
      entityId: row.entityDoc?.entity_id ?? (tab === "vehicle" ? summary?.trip.vehicle_id : summary?.trip.driver_id) ?? summary?.trip.id,
      docType: row.type,
    }).then((url) => {
      if (cancelled) return;
      setPreviewUrl(url);
      setPreviewMime(guessCompliancePreviewMime(path, row.doc?.mime_type));
      setLoadingPreview(false);
    });
    return () => {
      cancelled = true;
    };
  }, [previewable, docIndex, tab, canViewDocuments, organizationId, summary?.trip.id, summary?.trip.vehicle_id, summary?.trip.driver_id]);

  const goNext = () => {
    if (previewable.length === 0) return;
    setDocIndex((index) => (index + 1) % previewable.length);
    setZoom(1);
  };
  const goPrev = () => {
    if (previewable.length === 0) return;
    setDocIndex((index) => (index - 1 + previewable.length) % previewable.length);
    setZoom(1);
  };

  const approve = async () => {
    if (!summary || !activeRow || !actorId || !canVerify || busy) return;
    if (!complianceReviewDecisionActions(activeRow).canApprove) return;
    setBusy(true);
    try {
      if (tab === "trip") {
        if (!activeRow.doc) return;
        const { error } = await setTripDocumentVerification({
          document: activeRow.doc,
          organizationId,
          actorId,
          status: "verified",
        });
        if (error) {
          alertMessage("Couldn't approve document", error.message);
          return;
        }
      } else if (activeRow.entityDoc?.source === "vehicle-vault" && summary.trip.vehicle_id) {
        const marked = await markVehicleDocumentVerified(organizationId, summary.trip.vehicle_id, activeRow.type);
        if (marked.error) {
          alertMessage("Couldn't approve document", marked.error.message);
          return;
        }
      } else if (activeRow.entityDoc?.id && activeRow.entityDoc.source !== "driver-kyc") {
        const { error } = await verifyDocument(activeRow.entityDoc.id, actorId);
        if (error) {
          alertMessage("Couldn't approve document", error.message);
          return;
        }
      } else {
        alertMessage("Couldn't approve document", "This document can't be approved from this preview.");
        return;
      }
      onChanged(summary.trip.id);
      goNext();
    } finally {
      setBusy(false);
    }
  };

  const decline = async () => {
    if (!summary || !activeRow || !actorId || !canVerify || busy) return;
    if (!complianceReviewDecisionActions(activeRow).canDecline) return;
    const reason = declineReason.trim();
    if (!reason) {
      setDeclineOpen(true);
      return;
    }
    setBusy(true);
    try {
      if (tab === "trip") {
        if (!activeRow.doc) return;
        const { error } = await setTripDocumentVerification({
          document: activeRow.doc,
          organizationId,
          actorId,
          status: "rejected",
          rejectionReason: reason,
        });
        if (error) {
          alertMessage("Couldn't decline document", error.message);
          return;
        }
      } else if (activeRow.entityDoc?.source === "vehicle-vault") {
        alertMessage("Couldn't decline document", "Replace this file from the vehicle vault, or upload a new copy.");
        return;
      } else if (activeRow.entityDoc?.id && activeRow.entityDoc.source !== "driver-kyc") {
        const { error } = await rejectDocument(activeRow.entityDoc.id, reason);
        if (error) {
          alertMessage("Couldn't decline document", error.message);
          return;
        }
      } else {
        alertMessage("Couldn't decline document", "This document can't be declined from this preview.");
        return;
      }
      setDeclineOpen(false);
      setDeclineReason("");
      onChanged(summary.trip.id);
      goNext();
    } finally {
      setBusy(false);
    }
  };

  const decisions = activeRow ? complianceReviewDecisionActions(activeRow) : { canApprove: false, canDecline: false };
  const docTitle = activeRow ? labelForDocType(activeRow.type) : "No document";
  const isPdf = (previewMime ?? "").includes("pdf");
  const readiness = summary ? deriveComplianceQueueReadiness(summary) : null;
  const showPay = Boolean(canManageFinance && readiness?.paymentReady && onPay && summary);

  return (
    <View style={[styles.workspace, stacked && styles.workspaceStacked, style]}>
      <View style={[styles.listPane, stacked && styles.listPaneStacked]}>
        <ScrollView
          style={styles.listScroll}
          nestedScrollEnabled
          showsVerticalScrollIndicator
          contentContainerStyle={styles.listContent}
        >
          {summaries.map((item) => (
            <TripListRow
              key={item.trip.id}
              summary={item}
              selected={item.trip.id === summary?.trip.id}
              onPress={() => {
                setSelectedId(item.trip.id);
                setTab("trip");
              }}
            />
          ))}
        </ScrollView>
      </View>

      <View style={styles.previewPane}>
        <View style={styles.tabRow}>
          <View style={styles.tabGroup}>
            {TABS.map((item) => {
              const active = tab === item.key;
              return (
                <Pressable
                  key={item.key}
                  onPress={() => setTab(item.key)}
                  style={[styles.tab, active && styles.tabActive]}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                >
                  <Text style={[styles.tabText, active && styles.tabTextActive]}>{item.label}</Text>
                </Pressable>
              );
            })}
          </View>
          <View style={styles.previewTools}>
            <View style={styles.navPill}>
              <Pressable onPress={goPrev} hitSlop={8} accessibilityLabel="Previous document" disabled={previewable.length < 2}>
                <ChevronLeft size={16} color={Theme.textPrimaryDark} />
              </Pressable>
              <Text style={styles.navLabel} numberOfLines={1}>{docTitle}</Text>
              <Pressable onPress={goNext} hitSlop={8} accessibilityLabel="Next document" disabled={previewable.length < 2}>
                <ChevronRight size={16} color={Theme.textPrimaryDark} />
              </Pressable>
            </View>
            <View style={styles.zoomBar}>
            <Pressable style={styles.zoomBtn} onPress={() => setZoom((value) => Math.max(0.6, Number((value - 0.2).toFixed(2))))} accessibilityLabel="Zoom out">
              <Minus size={14} color={Theme.textPrimaryDark} />
            </Pressable>
            <Text style={styles.zoomLabel}>{Math.round(zoom * 100)}%</Text>
            <Pressable style={styles.zoomBtn} onPress={() => setZoom((value) => Math.min(2.4, Number((value + 0.2).toFixed(2))))} accessibilityLabel="Zoom in">
              <Plus size={14} color={Theme.textPrimaryDark} />
            </Pressable>
            <Pressable style={styles.zoomBtn} onPress={() => setZoom(1)} accessibilityLabel="Reset zoom">
              <RotateCcw size={14} color={Theme.textPrimaryDark} />
            </Pressable>
            </View>
          </View>
        </View>

        <View style={styles.stage}>

          {loadingPreview ? (
            <View style={styles.stageBody}>
              <ActivityIndicator color={Theme.textPrimaryDark} />
            </View>
          ) : previewUrl ? (
            <OriginalDocumentPreview uri={previewUrl} isPdf={isPdf} zoom={zoom} label={docTitle} />
          ) : (
            <View style={styles.stageBody}>
              <Text style={styles.emptyPreview}>
                {activeRow ? `${docTitle} has no file to preview.` : "Select a trip to preview documents."}
              </Text>
            </View>
          )}
        </View>

        {declineOpen ? (
          <TextInput
            style={styles.reasonInput}
            value={declineReason}
            onChangeText={setDeclineReason}
            placeholder="Reason for declining"
            placeholderTextColor={Theme.textMuted}
          />
        ) : null}

        <View style={styles.decisionRow}>
          <Pressable
            style={[styles.declineBtn, (!decisions.canDecline || !canVerify || busy) && styles.btnDisabled]}
            disabled={!decisions.canDecline || !canVerify || busy}
            onPress={() => void decline()}
            accessibilityRole="button"
            accessibilityLabel="Decline document"
          >
            <Text style={styles.declineText}>{declineOpen ? "Confirm decline" : "Decline"}</Text>
          </Pressable>
          <Pressable
            style={[styles.approveBtn, (!decisions.canApprove || !canVerify || busy) && styles.btnDisabled]}
            disabled={!decisions.canApprove || !canVerify || busy}
            onPress={() => void approve()}
            accessibilityRole="button"
            accessibilityLabel="Approve document"
          >
            <Text style={styles.approveText}>Approve</Text>
          </Pressable>
          <View style={styles.actionEnd}>
            {showPay && summary ? (
              <Pressable
                style={styles.payBtn}
                onPress={() => onPay?.(summary)}
                accessibilityRole="button"
                accessibilityLabel="Pay"
              >
                <Text style={styles.payText}>Pay</Text>
              </Pressable>
            ) : null}
            <Pressable
              style={[styles.navBtn, previewable.length < 2 && styles.btnDisabled]}
              onPress={goPrev}
              disabled={previewable.length < 2}
              accessibilityRole="button"
              accessibilityLabel="Previous"
            >
              <ChevronLeft size={16} color={Theme.textPrimaryDark} />
              <Text style={styles.navBtnText}>Previous</Text>
            </Pressable>
            <Pressable
              style={[styles.navBtn, previewable.length < 2 && styles.btnDisabled]}
              onPress={goNext}
              disabled={previewable.length < 2}
              accessibilityRole="button"
              accessibilityLabel="Next"
            >
              <Text style={styles.navBtnText}>Next</Text>
              <ChevronRight size={16} color={Theme.textPrimaryDark} />
            </Pressable>
          </View>
        </View>
      </View>
    </View>
  );
}

function TripListRow({
  summary,
  selected,
  onPress,
}: {
  summary: ComplianceTripSummary;
  selected: boolean;
  onPress: () => void;
}) {
  const trip = summary.trip;
  const verification = verificationStatusVisual(summary);
  const clientName = trip.client_name?.trim() || "—";
  const origin = splitHubRouteLocationDisplay(trip.pickup_area ?? "");
  const dest = splitHubRouteLocationDisplay(trip.drop_location ?? "");
  const vehicle = formatIndianVehicleNumber(trip.vehicle_display_number?.trim() || "").trim() || trip.vehicle_display_number?.trim() || "Unassigned";
  const driver = trip.driver_display_name?.trim() || "Unassigned";
  const executionModel = getTripExecutionModel(trip);
  const isAsset = executionModel === "asset";
  return (
    <Pressable onPress={onPress} style={[styles.row, selected && styles.rowSelected]} accessibilityRole="button">
      <View style={styles.rowHead}>
        <PartyAvatar name={clientName} entityType="client" size={30} initialsColorSeed={trip.client_id ?? trip.id} />
        <View style={styles.rowTitle}>
          <Text style={styles.client} numberOfLines={1}>{clientName.toUpperCase()}</Text>
          <View style={styles.idLine}>
            <Text style={styles.tripId} numberOfLines={1}>{complianceTripDisplayId(trip)}</Text>
            <View style={[styles.modelTag, isAsset ? styles.modelTagAsset : styles.modelTagAggregate]}>
              <Text style={[styles.modelTagText, isAsset ? styles.modelTagTextAsset : styles.modelTagTextAggregate]}>
                {isAsset ? "Asset" : "Aggregate"}
              </Text>
            </View>
          </View>
        </View>
        <View style={styles.rowMeta}>
          <View style={[styles.statusPill, { backgroundColor: verification.tone.bg }]}>
            <Text style={[styles.statusText, { color: verification.tone.fg }]} numberOfLines={1}>
              {verification.label.toUpperCase()}
            </Text>
          </View>
          <Text style={styles.when} numberOfLines={1}>{formatComplianceTimestamp(complianceEventAt(trip))}</Text>
        </View>
      </View>
      <View style={styles.route}>
        <View style={styles.leg}>
          <Text style={styles.city} numberOfLines={1}>{origin.city || "—"}</Text>
          <Text style={styles.region} numberOfLines={1}>{origin.state || " "}</Text>
        </View>
        <View style={styles.arrowSlot}>
          <Text style={styles.arrow}>→</Text>
        </View>
        <View style={[styles.leg, styles.legEnd]}>
          <Text style={[styles.city, styles.alignEnd]} numberOfLines={1}>{dest.city || "—"}</Text>
          <Text style={[styles.region, styles.alignEnd]} numberOfLines={1}>{dest.state || " "}</Text>
        </View>
      </View>
      <View style={styles.party}>
        <Text style={styles.partyText} numberOfLines={1}>{vehicle}</Text>
        <Text style={[styles.partyText, styles.alignEnd]} numberOfLines={1}>{driver}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  workspace: { flex: 1, minHeight: 0, flexDirection: "row", alignItems: "stretch", gap: 16, overflow: "hidden" },
  workspaceStacked: { flexDirection: "column" },
  listPane: {
    width: 380,
    maxWidth: "42%",
    flexShrink: 0,
    minHeight: 0,
    height: "100%",
    alignSelf: "stretch",
    backgroundColor: Theme.cardWhite,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Theme.complianceCardBorder,
    overflow: "hidden",
  },
  listPaneStacked: { width: "100%", maxWidth: "100%", height: "42%", maxHeight: "42%" },
  listScroll: { flex: 1 },
  listContent: { padding: 10, gap: 8 },
  row: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Theme.complianceCardBorder,
    backgroundColor: Theme.cardWhite,
    paddingHorizontal: 12,
    paddingVertical: 11,
    gap: 10,
  },
  rowSelected: { borderColor: Theme.analyticsHeroBg, backgroundColor: Theme.brandBlueWashSubtle },
  rowHead: { flexDirection: "row", alignItems: "center", gap: 10 },
  rowTitle: { flex: 1, minWidth: 0, gap: 1 },
  client: { fontSize: 12, fontWeight: "600", letterSpacing: 0.2, color: Theme.textPrimaryDark },
  idLine: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2, minWidth: 0 },
  tripId: { flexShrink: 1, fontSize: 11, fontWeight: "500", color: Theme.analyticsHeroBg },
  modelTag: { flexShrink: 0, borderRadius: 999, paddingHorizontal: 6, paddingVertical: 1 },
  modelTagAsset: { backgroundColor: Theme.positiveMuted },
  modelTagAggregate: { backgroundColor: Theme.aggregatePillBg },
  modelTagText: { fontSize: 9, fontWeight: "600", letterSpacing: 0.2, lineHeight: 12 },
  modelTagTextAsset: { color: Theme.darkGreen },
  modelTagTextAggregate: { color: Theme.aggregatePillText },
  rowMeta: { width: 118, alignItems: "flex-end", justifyContent: "center", gap: 3 },
  statusPill: { maxWidth: 118, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2 },
  statusText: { fontSize: 9, fontWeight: "600", letterSpacing: 0.3 },
  when: { fontSize: 10, fontWeight: "400", color: Theme.textMuted, textAlign: "right" },
  route: { flexDirection: "row", alignItems: "center" },
  leg: { flex: 1, minWidth: 0 },
  legEnd: { alignItems: "flex-end" },
  city: { fontSize: 11, fontWeight: "600", letterSpacing: 0.3, color: Theme.textPrimaryDark, textTransform: "uppercase" },
  region: { fontSize: 10, fontWeight: "400", color: Theme.textMuted, marginTop: 1 },
  alignEnd: { textAlign: "right", alignSelf: "stretch" },
  arrowSlot: { width: 28, alignItems: "center", justifyContent: "center" },
  arrow: { fontSize: 13, fontWeight: "400", color: Theme.textMuted },
  party: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Theme.complianceCardBorder,
    paddingTop: 8,
  },
  partyText: { flex: 1, minWidth: 0, fontSize: 12, fontWeight: "500", color: Theme.textSecondary },
  previewPane: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    backgroundColor: Theme.cardWhite,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Theme.complianceCardBorder,
    padding: 14,
    gap: 12,
  },
  tabRow: { flexShrink: 0, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  tabGroup: { flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 1, minWidth: 0 },
  tab: {
    height: 36,
    minWidth: 88,
    paddingHorizontal: 16,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: Theme.complianceCardBorder,
    backgroundColor: Theme.cardWhite,
    alignItems: "center",
    justifyContent: "center",
  },
  tabActive: { backgroundColor: Theme.buttonDark, borderColor: Theme.buttonDark },
  tabText: { fontSize: 13, fontWeight: "500", lineHeight: 16, textAlign: "center", color: Theme.textPrimaryDark },
  tabTextActive: { color: Theme.buttonDarkText, fontWeight: "600" },
  stage: {
    flex: 1,
    minHeight: 0,
    borderRadius: 16,
    backgroundColor: Theme.compliancePageBg,
    overflow: "hidden",
    paddingTop: 12,
    paddingBottom: 12,
    paddingHorizontal: 12,
  },
  previewTools: { flexShrink: 0, flexDirection: "row", alignItems: "center", gap: 8 },
  zoomBar: {
    flexShrink: 0,
    height: 36,
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    backgroundColor: Theme.cardWhite,
    borderRadius: 999,
    paddingHorizontal: 6,
    borderWidth: 1,
    borderColor: Theme.complianceCardBorder,
  },
  zoomBtn: { width: 28, height: 28, alignItems: "center", justifyContent: "center" },
  zoomLabel: { fontSize: 12, fontWeight: "500", color: Theme.textPrimaryDark, minWidth: 40, textAlign: "center" },
  stageBody: { flex: 1, minHeight: 0, width: "100%" },
  stageScroll: { flex: 1, width: "100%", minHeight: 0 },
  stageFill: { width: "100%", height: "100%" },
  stageScrollCenter: { flexGrow: 1, alignItems: "center", justifyContent: "center" },
  stageScrollStart: { flexGrow: 1, alignItems: "flex-start", justifyContent: "flex-start" },
  emptyPreview: { fontSize: 14, color: Theme.textMuted, textAlign: "center" },
  navPill: {
    flexShrink: 1,
    minWidth: 0,
    height: 36,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: Theme.cardWhite,
    borderRadius: 999,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: Theme.complianceCardBorder,
  },
  navLabel: { fontSize: 12, fontWeight: "500", lineHeight: 16, color: Theme.textPrimaryDark, maxWidth: 120 },
  reasonInput: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: Theme.complianceCardBorder,
    borderRadius: 10,
    paddingHorizontal: 12,
    fontSize: 14,
    color: Theme.textPrimaryDark,
  },
  decisionRow: { flexShrink: 0, flexDirection: "row", alignItems: "center", gap: 8 },
  declineBtn: {
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Theme.negative,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Theme.cardWhite,
  },
  declineText: { fontSize: 13, fontWeight: "700", color: Theme.negative },
  approveBtn: {
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: Theme.positive,
    alignItems: "center",
    justifyContent: "center",
  },
  approveText: { fontSize: 13, fontWeight: "700", color: Theme.cardWhite },
  actionEnd: { marginLeft: "auto", flexDirection: "row", alignItems: "center", gap: 8 },
  payBtn: {
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: Theme.buttonPrimary,
    borderWidth: Theme.buttonPrimaryBorderWidth,
    borderColor: Theme.buttonPrimaryBorder,
    alignItems: "center",
    justifyContent: "center",
  },
  payText: { fontSize: 13, fontWeight: "600", color: Theme.buttonPrimaryText },
  navBtn: {
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Theme.complianceCardBorder,
    backgroundColor: Theme.cardWhite,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  navBtnText: { fontSize: 13, fontWeight: "600", lineHeight: 16, color: Theme.textPrimaryDark },
  btnDisabled: { opacity: 0.45 },
});
