/**
 * Debit control — POD Verification: the trip detail Credit Note / Debit Note
 * panel (TripFinanceAdjustmentsPanel + ProvisionAdjustmentModal) for one trip.
 */
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import Theme from "@/constants/Theme";
import { useOptionalOrganization } from "@/contexts/OrganizationContext";
import { useValidatePodsMutation } from "@/features/debit-control/hooks/useDebitControlPod";
import { getTripTransactionsForOrg } from "@/features/finance/services/finance.service";
import { ComplianceSettlementBreakdown } from "@/features/tripCompliance/components/ComplianceSettlementBreakdown";
import { complianceSettlementSummary } from "@/features/tripCompliance/utils/complianceSettlementSummary.util";
import { TripPayableReceivableSummaryCard } from "@/features/trips/components/trip-detail/adjustment/TripPayableReceivableSummaryCard";
import { getTripOperationalDisplay } from "@/features/operations/display";
import { podChargesFromAdjustments } from "@/features/tripCompliance/utils/podChargesFromAdjustments.util";
import {
  ProvisionAdjustmentModal,
  type ProvisionSide,
} from "@/features/trips/components/trip-detail/adjustment/ProvisionAdjustmentModal";
import { ProvisionNotePdfModal } from "@/features/trips/components/trip-detail/adjustment/ProvisionNotePdfModal";
import { TripFinanceAdjustmentsPanel } from "@/features/trips/components/trip-detail/adjustment/TripFinanceAdjustmentsPanel";
import type { ProvisionNotePdfContext } from "@/features/trips/components/trip-detail/adjustment/tripProvisionNotePdf.util";
import { provisionLineMetaLabel } from "@/features/trips/components/trip-detail/tripDetail.helpers";
import {
  addTripAdjustment,
  adjustedCost,
  adjustedRevenue,
  getTripAdjustments,
  isAdjustmentVoided,
  updateTripAdjustment,
  type TripAdjustment,
  type TripAdjustmentImpact,
  type TripAdjustmentType,
} from "@/features/trips/services/tripAdjustments";
import { getTripDisplayNumber, type TripRow } from "@/features/trips/services/trips.service";
import { queryKeys } from "@/lib/queryKeys";

type AdjustmentParams = {
  type: TripAdjustmentType;
  impact: TripAdjustmentImpact;
  amount: number;
  reason: string;
};

export function ComplianceTripAdjustmentsPane({
  trip,
  supplierName,
  canAddAdjustment,
  actorId = null,
  onPodVerified,
}: {
  trip: TripRow;
  supplierName: string;
  canAddAdjustment: boolean;
  actorId?: string | null;
  /** Set → shows Mark POD Verified (moves the trip to Settlement Verification). */
  onPodVerified?: (tripId: string) => void;
}) {
  const queryClient = useQueryClient();
  const currentOrganization = useOptionalOrganization()?.currentOrganization ?? null;
  const [side, setSide] = useState<ProvisionSide | null>(null);
  const [editTarget, setEditTarget] = useState<TripAdjustment | null>(null);
  const [pdfContext, setPdfContext] = useState<ProvisionNotePdfContext | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const validate = useValidatePodsMutation(currentOrganization?.id ?? null, actorId);

  const adjustmentsKey = useMemo(
    () => [...queryKeys.tripFinanceAdjustmentsRoot, "compliance", trip.id] as const,
    [trip.id],
  );
  const adjustmentsQuery = useQuery({
    queryKey: adjustmentsKey,
    queryFn: () => getTripAdjustments(trip.id),
  });
  const adjustments = useMemo(() => adjustmentsQuery.data ?? [], [adjustmentsQuery.data]);

  const sales = Number(trip.client_price ?? 0) || 0;
  const cost = Number(trip.supplier_rate ?? 0) || 0;
  const adjSales = adjustedRevenue(sales, adjustments);
  const adjCost = adjustedCost(cost, adjustments);
  const clientName = trip.client_name?.trim() || "Client";
  const tripCode = getTripDisplayNumber(trip, currentOrganization?.id ?? null);

  const orgId = currentOrganization?.id ?? null;
  const ledgerQuery = useQuery({
    queryKey: ["q", "tripCompliance", "settlementLedger", "v1", orgId, trip.id] as const,
    queryFn: async () => {
      const res = await getTripTransactionsForOrg(orgId!, trip.id);
      if (res.error) throw res.error;
      return res.transactions;
    },
    enabled: !!orgId,
  });
  /** Same targets as the trip detail Finance hub card, split into base → CN/DN → paid → final. */
  const settlement = useMemo(
    () =>
      complianceSettlementSummary({
        trip,
        viewerOrgId: orgId,
        adjustments,
        ledgerEntries: ledgerQuery.data ?? [],
      }),
    [adjustments, ledgerQuery.data, orgId, trip],
  );

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: [...queryKeys.tripFinanceAdjustmentsRoot] });
  }, [queryClient]);

  const handleSave = useCallback(
    async (params: AdjustmentParams) => {
      // Same org rule as trip detail: the viewer's org owns the line when it isn't the trip owner.
      const tripOwnerOrgId = trip.organization_id?.trim() || null;
      const viewerOrgId = currentOrganization?.id?.trim() || null;
      const orgId = tripOwnerOrgId && tripOwnerOrgId === viewerOrgId ? tripOwnerOrgId : (viewerOrgId ?? tripOwnerOrgId);
      const missionRaw = getTripOperationalDisplay({
        trip_operational_code: trip.trip_operational_code ?? null,
        trip_code: trip.trip_code ?? null,
        display_trip_id: (trip as { display_trip_id?: string | null }).display_trip_id ?? null,
        trip_number: (trip as { trip_number?: string | null }).trip_number ?? null,
      });
      await addTripAdjustment(
        trip.id,
        params,
        orgId ? { organizationId: orgId, missionKey: missionRaw === "—" ? null : missionRaw } : undefined,
      );
      await refresh();
    },
    [currentOrganization?.id, refresh, trip],
  );

  const handleUpdate = useCallback(
    async (adjustmentId: string, params: AdjustmentParams) => {
      await updateTripAdjustment(trip.id, adjustmentId, params);
      await refresh();
    },
    [refresh, trip.id],
  );

  const markPodVerified = useCallback(async () => {
    if (!onPodVerified || validate.isPending || adjustmentsQuery.isLoading) return;
    setVerifyError(null);
    // Same POD-validated record the old form wrote; charges come from the CN/DN lines.
    const charges = podChargesFromAdjustments({ clientPrice: sales, supplierRate: cost, adjustments });
    try {
      const result = await validate.mutateAsync([
        {
          tripId: trip.id,
          remarks: "",
          clientInvoiceNumber: null,
          tripStartDate: trip.pickup_date ?? trip.started_at ?? null,
          deliveryDate: trip.completed_at ?? null,
          dispatchDate: null,
          client: charges.client,
          vendor: charges.vendor,
        },
      ]);
      if (result.updatedIds.includes(trip.id)) {
        onPodVerified(trip.id);
        return;
      }
      setVerifyError(result.error?.message ?? "Couldn't mark POD verified.");
    } catch (error) {
      setVerifyError(error instanceof Error ? error.message : "Couldn't mark POD verified.");
    }
  }, [adjustments, adjustmentsQuery.isLoading, cost, onPodVerified, sales, trip, validate]);

  const openEdit = useCallback((adj: TripAdjustment) => {
    if (isAdjustmentVoided(adj)) return;
    setEditTarget(adj);
    setSide(adj.type === "revenue" ? "client" : "supplier");
  }, []);

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.title}>Credit / Debit Notes</Text>
        <Text style={styles.subtitle} numberOfLines={1}>
          {tripCode} · {clientName}
        </Text>
      </View>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <TripPayableReceivableSummaryCard
          layout="desktop"
          clientName={clientName}
          clientAvatarSeed={trip.client_id ?? null}
          revisedReceivable={settlement.receivable.revised}
          collectedAmount={settlement.receivable.settled}
          receivableDue={Math.max(0, settlement.receivable.balance)}
          payablePartyName={supplierName}
          payableAvatarSeed={trip.supplier_id ?? null}
          payableEntityType="supplier"
          payableLaneLabel="Payable"
          revisedPayable={settlement.payable.revised}
          paidAmount={settlement.payable.settled}
          payableDue={Math.max(0, settlement.payable.balance)}
        />
        {ledgerQuery.isError ? (
          <Text style={styles.ledgerError}>Couldn't load payments for this trip. Paid amounts may show ₹0.</Text>
        ) : null}
        <ComplianceSettlementBreakdown
          summary={settlement}
          clientName={clientName}
          supplierName={supplierName}
        />
        <View style={styles.sectionGap} />
        <TripFinanceAdjustmentsPanel
          canAddAdjustment={canAddAdjustment}
          adjustments={adjustments}
          sales={sales}
          adjSales={adjSales}
          revenueSideDelta={adjSales - sales}
          cost={cost}
          adjCost={adjCost}
          costSideDelta={adjCost - cost}
          clientName={clientName}
          clientAvatarSeed={trip.client_id ?? null}
          supplierName={supplierName}
          supplierAvatarSeed={trip.supplier_id ?? null}
          costUnset={!!(trip.supplier_id ?? "").trim() && cost === 0}
          lineMetaLabel={provisionLineMetaLabel}
          onOpenProvision={(next) => {
            setEditTarget(null);
            setSide(next);
          }}
          onViewNotePdf={(adj) => {
            const isSale = adj.type === "revenue";
            setPdfContext({
              adjustment: adj,
              tripCode,
              companyName: currentOrganization?.name?.trim() || "PULSE",
              partyName: isSale ? clientName : supplierName,
              laneLabel: isSale ? "Sale" : "Cost",
              partyRole: isSale ? "Client" : "Supplier",
              baseLaneAmount: isSale ? sales : cost,
              revisedLaneAmount: isSale ? adjSales : adjCost,
            });
          }}
          onEditAdjustment={canAddAdjustment ? openEdit : undefined}
        />
      </ScrollView>
      {onPodVerified ? (
        <View style={styles.footer}>
          {verifyError ? (
            <Text style={styles.verifyError} numberOfLines={2}>
              {verifyError}
            </Text>
          ) : (
            <Text style={styles.footerHint} numberOfLines={2}>
              Sends the trip to Settlement Verification with the CN/DN lines above.
            </Text>
          )}
          <Pressable
            style={[styles.verifyBtn, (validate.isPending || adjustmentsQuery.isLoading) && styles.verifyBtnDisabled]}
            onPress={() => void markPodVerified()}
            disabled={validate.isPending || adjustmentsQuery.isLoading}
            accessibilityRole="button"
            accessibilityLabel="Mark POD Verified"
          >
            {validate.isPending ? (
              <ActivityIndicator size="small" color={Theme.textOnPrimary} />
            ) : (
              <Text style={styles.verifyBtnText}>Mark POD Verified</Text>
            )}
          </Pressable>
        </View>
      ) : null}

      <ProvisionAdjustmentModal
        visible={side !== null}
        side={side}
        onClose={() => {
          setSide(null);
          setEditTarget(null);
        }}
        onSave={handleSave}
        editTarget={editTarget}
        onUpdate={handleUpdate}
        tripCode={tripCode}
        partyLabel={side === "client" ? clientName : supplierName}
        clientName={clientName}
        clientAvatarSeed={trip.client_id ?? null}
        supplierName={supplierName}
        supplierAvatarSeed={trip.supplier_id ?? null}
        sales={sales}
        adjSales={adjSales}
        cost={cost}
        adjCost={adjCost}
        revenueSideDelta={adjSales - sales}
        costSideDelta={adjCost - cost}
        adjustments={adjustments}
        lineMetaLabel={provisionLineMetaLabel}
      />
      <ProvisionNotePdfModal
        visible={pdfContext !== null}
        context={pdfContext}
        onClose={() => setPdfContext(null)}
        onEdit={
          canAddAdjustment && pdfContext && !isAdjustmentVoided(pdfContext.adjustment)
            ? (adj) => {
                setPdfContext(null);
                openEdit(adj);
              }
            : undefined
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0 },
  header: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: Theme.complianceCardBorder,
  },
  title: { fontSize: 16, fontWeight: "700", color: Theme.textPrimaryDark },
  subtitle: { marginTop: 2, fontSize: 12, color: Theme.textSecondary },
  scroll: { flex: 1 },
  scrollContent: { padding: 12 },
  sectionGap: { height: 12 },
  ledgerError: { marginTop: 8, fontSize: 12, color: Theme.negative },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: Theme.complianceCardBorder,
  },
  footerHint: { flex: 1, fontSize: 12, color: Theme.textSecondary },
  verifyError: { flex: 1, fontSize: 12, color: Theme.negative },
  verifyBtn: {
    minHeight: 44,
    paddingHorizontal: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Theme.primary,
  },
  verifyBtnDisabled: { opacity: 0.5 },
  verifyBtnText: { fontSize: 14, fontWeight: "700", color: Theme.textOnPrimary },
});
