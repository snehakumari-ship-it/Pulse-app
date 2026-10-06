/**
 * Multi-order Job Card — route → current stop → orders → one action.
 * Primitive A runs only while this card is mounted. Mode is never decided here.
 */
import Theme from '@/constants/Theme';
import Layout from '@/constants/Layout';
import { TRIP_SHEET_BODY_PAD, TRIP_SHEET_TOP_RADIUS } from '@/components/driver/DriverTripSheetLayout';
import { MissionCardLayout } from '@/features/driver/components/MissionCardLayout';
import { planStopsFromLabeled } from '@/features/driver/components/missionPlanRows';
import { useAuth } from '@/contexts/AuthContext';
import { useDriverThemeColors } from '@/contexts/DriverThemeContext';
import { useDriverCommerceMission } from '@/features/driver/commerce-mission/useDriverCommerceMission';
import type { DriverTripFlowCardProps } from '@/features/driver/components/DriverTripFlowCard';
import type { DriverTripStopOrder } from '@/features/driver/commerce-mission/driverTripStopOrders.types';
import type { DriverStopExecutionStop } from '@/features/driver/execution/driverStopExecution.types';
import type { DriverStopExecutionController } from '@/features/driver/hooks/useDriverStopExecution';
import {
  canShowArriveAction,
  canShowCompleteAction,
} from '@/features/driver/execution/resolveDriverStopTransition';
import { ordersOnStop } from '@/features/driver/job-card/attachOrdersToStop';
import {
  buildCommerceTripExecution,
  summaryLabel,
  type CommerceProductLine,
} from '@/features/driver/job-card/commerceTripExecution';
import { buildDriverRoutePlanMap, routePlanKind } from '@/features/driver/job-card/driverRoutePlanMap';
import {
  formatStopKm,
  formatStopPlace,
  isDeliveryStop,
  multiOrderActionModel,
} from '@/features/driver/job-card/multiOrderStopCopy';
import {
  overlayCommerceStopsOnExecution,
  ROUTE_SETUP_PENDING_MESSAGE,
} from '@/features/driver/job-card/sesStopsFromCommerceMission';
import {
  persistStopDeliveryProof,
  type StopProofLedger,
} from '@/features/driver/job-card/persistStopDeliveryProof';
import type { DeliveryProofDraft } from '@/features/driver/job-card/deliveryProof';
import { DriverStopVerificationScreen } from '@/features/driver/job-card/DriverStopVerificationScreen';
import { DriverTripCompletionScreen } from '@/features/driver/job-card/DriverTripCompletionScreen';
import { CurrentStopCard } from '@/features/driver/job-card/parts/CurrentStopCard';
import { RouteProgressHeader } from '@/features/driver/job-card/parts/RouteProgressHeader';
import { RouteProgressTrack } from '@/features/driver/job-card/parts/RouteProgressTrack';
import {
  RouteTimeline,
  type RouteTimelineProgress,
  type RouteTimelineStop,
} from '@/features/driver/job-card/parts/RouteTimeline';
import type { StopOrderSummaryOrder } from '@/features/driver/job-card/parts/StopOrderSummary';
import type { StatusTone } from '@/features/driver/job-card/parts/jobCardSurface';
import type { RouteStopStats } from '@/features/driver/job-card/parts/RouteProgressHeader';
import { StopActionButton } from '@/features/driver/job-card/parts/StopActionButton';
import { completedStopCount } from '@/features/driver/job-card/attachOrdersToStop';
import { allStopsFinished } from '@/features/driver/job-card/tripCompletionSummary';
import * as tripsService from '@/features/trips/services/trips.service';
import {
  applyDriverCommandResult,
  executeDriverCommand,
  type DriverCommandResult,
} from '@/features/driver/services/driverExecution.service';
import { getTripStopCoordinate } from '@/features/trips/domain';
import {
  DRIVER_PAY_NA_AMOUNT,
  DRIVER_PAY_NA_LABEL,
  isAggregateTrip,
} from '@/features/drivers/utils/driverUtils.util';
import { formatINR, formatTime } from '@/lib/format';
import { formatEstimatedDuration } from '@/lib/formatEstimatedDuration';
import { openExternalNavigation } from '@/lib/mapsNavigation.util';
import { DeliveryDetailsPreview, type DeliveryPreviewStop } from '@/features/driver/job-card/parts/DeliveryDetailsPreview';
import { ChevronUp } from 'lucide-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Pressable, StyleSheet, Text, View } from 'react-native';

type Props = DriverTripFlowCardProps & {
  stopExecution: DriverStopExecutionController;
};

export function DriverMultiOrderJobCard({
  trip,
  stopExecution,
  collapsed = false,
  onToggleCollapse,
  edgeToEdge = false,
  variant = 'card',
  distanceToTargetKm,
  commissionAmount,
  assignedBy = null,
  onRoutePlanMapChange,
  onShowRouteOnMap,
  onTripCompleted,
  onTripUpdated,
  deliveryDetailsNonce = 0,
}: Props) {
  const colors = useDriverThemeColors();
  const { profile } = useAuth();
  const { mutating, arrive, complete } = stopExecution;
  const sesReady = stopExecution.stops.length > 0;
  const missionState = useDriverCommerceMission(trip.id);
  const mission = missionState.status === 'error' ? null : missionState.mission;
  const execution = useMemo(
    () => overlayCommerceStopsOnExecution(stopExecution, mission, trip),
    [stopExecution, mission, trip],
  );
  const commerce = useMemo(
    () => buildCommerceTripExecution({
      trip,
      mission,
      sesStops: stopExecution.stops,
    }),
    [trip, mission, stopExecution.stops],
  );
  const { stops, currentStop, nextStop } = execution;
  const orderCount = commerce.summary.orderCount;
  const commerceSummary = commerce.stops.length > 0 ? summaryLabel(commerce.summary) : null;
  const done = sesReady ? completedStopCount(stops) : 0;
  const [actionError, setActionError] = useState<string | null>(null);
  const [verificationOpen, setVerificationOpen] = useState(false);
  const [verified, setVerified] = useState(false);
  const [proofBusy, setProofBusy] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const seenDetailsNonce = useRef(deliveryDetailsNonce);
  const [completingTrip, setCompletingTrip] = useState(false);
  const [completeError, setCompleteError] = useState<string | null>(null);
  const [markedComplete, setMarkedComplete] = useState(false);
  const summaryOfferedRef = useRef(false);
  const proofLedgersRef = useRef(new Map<string, StopProofLedger>());
  const [verifySession, setVerifySession] = useState<{
    stop: DriverStopExecutionStop;
    orders: DriverTripStopOrder[];
    stopIndex: number;
    review: boolean;
  } | null>(null);

  const currentId = currentStop?.stopId ?? null;
  const routeFinished = sesReady && allStopsFinished(stops);
  const tripCompleted =
    markedComplete || String(trip.status ?? '').toLowerCase() === 'completed';
  const completionHandledRef = useRef(String(trip.status ?? '').toLowerCase() === 'completed');
  const orders = ordersOnStop(mission, currentId);
  const canArrive = sesReady && currentStop ? canShowArriveAction(currentStop, currentId) : false;
  const canComplete = sesReady && currentStop ? canShowCompleteAction(currentStop, currentId) : false;
  const rawModel = multiOrderActionModel(currentStop, orders.length);
  const actionModel = !sesReady
    ? {
        kind: 'idle' as const,
        stageLabel: 'Route setup pending',
        hint: ROUTE_SETUP_PENDING_MESSAGE,
        cta: null,
      }
    : (rawModel.kind === 'arrive' && !canArrive) || (rawModel.kind === 'complete' && !canComplete)
      ? { ...rawModel, kind: 'idle' as const, cta: null }
      : rawModel;

  const timelineStops = useMemo((): RouteTimelineStop[] => {
    const modelById = new Map(commerce.stops.map((stop) => [stop.id, stop]));
    const ordered = [...stops].sort((a, b) => a.sequence - b.sequence);
    return ordered.map((stop) => {
      const model = modelById.get(stop.stopId);
      const orders: StopOrderSummaryOrder[] = model
        ? model.orders.map((order) => ({
            id: order.id,
            orderNumber: order.orderNumber,
            productCount: order.productCount,
            lines: order.lines,
          }))
        : ordersOnStop(mission, stop.stopId).map((order) => ({
            id: order.salesOrderId,
            orderNumber: order.orderNumber,
            productCount: order.lines?.length ?? 0,
            lines: (order.lines ?? []).map((line): CommerceProductLine => ({
              productId: line.productId ?? null,
              name: line.productName ?? null,
              sku: line.productSku ?? null,
              quantity: line.quantity,
              unit: null,
            })),
          }));
      const productCount = orders.reduce((sum, order) => sum + order.productCount, 0);
      const status = stop.status;
      const isCurrent = stop.stopId === currentId;
      const statusLabel =
        status === 'completed'
          ? 'Done'
          : status === 'skipped'
            ? 'Skipped'
            : status === 'arrived'
              ? 'Arrived'
              : status === 'failed'
                ? 'Failed'
                : isCurrent
                  ? 'Next up'
                  : 'Pending';
      const progress: RouteTimelineProgress =
        status === 'completed' || status === 'skipped'
          ? 'done'
          : status === 'failed'
            ? 'failed'
            : isCurrent
              ? 'current'
              : 'upcoming';
      const statusTone: StatusTone =
        status === 'completed'
          ? 'done'
          : status === 'failed'
            ? 'failed'
            : status === 'arrived'
              ? 'active'
              : isCurrent
                ? 'next'
                : 'pending';
      const at = status === 'completed' ? stop.completedAt : status === 'arrived' ? stop.arrivedAt : null;
      return {
        id: stop.stopId,
        sequence: stop.sequence,
        typeLabel: isDeliveryStop(String(stop.stopType)) ? 'Delivery' : 'Pickup',
        location: formatStopPlace(stop),
        statusLabel,
        statusTone,
        timeLabel: at ? formatTime(at) : null,
        progress,
        isCurrent,
        orderCount: orders.length,
        productCount,
        orders,
      };
    });
  }, [commerce.stops, stops, mission, currentId]);

  const stopStats = useMemo((): RouteStopStats | null => {
    if (!sesReady) return null;
    const stats: RouteStopStats = { pending: 0, arrived: 0, completed: 0, failed: 0 };
    for (const stop of stops) {
      if (stop.status === 'completed' || stop.status === 'skipped') stats.completed += 1;
      else if (stop.status === 'arrived') stats.arrived += 1;
      else if (stop.status === 'failed') stats.failed += 1;
      else stats.pending += 1;
    }
    return stats;
  }, [sesReady, stops]);

  const focusKind = currentStop
    ? (routePlanKind(String(currentStop.stopType)) === 'drop' ? 'drop' : 'pickup')
    : 'pickup';

  useEffect(() => {
    if (!onRoutePlanMapChange) return;
    onRoutePlanMapChange(buildDriverRoutePlanMap(trip.id, stops, currentId, focusKind, currentId));
  }, [trip.id, stops, currentId, focusKind, onRoutePlanMapChange]);

  useEffect(() => {
    return () => onRoutePlanMapChange?.(null);
  }, [onRoutePlanMapChange]);

  useEffect(() => {
    if (!routeFinished || summaryOfferedRef.current) return;
    summaryOfferedRef.current = true;
    setSummaryOpen(true);
  }, [routeFinished]);

  // The server completes the trip when the final stop finishes; whichever path
  // reports it first (stop result, Mark completed, refreshed trip) ends the mission once.
  useEffect(() => {
    if (!tripCompleted || completionHandledRef.current) return;
    completionHandledRef.current = true;
    void AsyncStorage.removeItem('driver_accepted_trip_id');
    onTripCompleted?.();
  }, [tripCompleted, onTripCompleted]);

  const frameless = variant === 'page' || edgeToEdge;
  const inSheet = variant === 'page' || edgeToEdge;
  const remainingKmLabel = formatStopKm(distanceToTargetKm ?? undefined);
  const sheetStyle = [
    styles.sheet,
    { backgroundColor: colors.surface },
    inSheet ? styles.sheetFill : null,
    frameless ? styles.edge : styles.inset,
    inSheet ? styles.sheetFlush : null,
  ];
  const pickupLabel = trip.pickup_area?.trim() || '—';
  const dropLabel =
    (trip.drop_location || (trip as { drop_area?: string | null }).drop_area)?.trim() || '—';
  const missionPlan = useMemo(() => {
    if (commerce.stops.length > 0) {
      return planStopsFromLabeled(
        commerce.stops.map((stop) => ({
          id: stop.id,
          sequence: stop.sequence,
          type: stop.type,
          place: stop.address?.trim() || stop.location,
          isCurrent: stop.isCurrent,
        })),
      );
    }
    if (stops.length > 1) {
      return planStopsFromLabeled(
        stops.map((stop) => ({
          id: stop.stopId,
          sequence: stop.sequence,
          type: String(stop.stopType),
          place: formatStopPlace(stop),
          isCurrent: stop.stopId === currentId,
        })),
      );
    }
    return null;
  }, [commerce.stops, stops, currentId]);

  const previewStops = useMemo((): DeliveryPreviewStop[] => {
    const modelById = new Map(commerce.stops.map((stop) => [stop.id, stop]));
    const source = stops.length > 0 ? stops : [];
    let pickupN = 0;
    let dropN = 0;
    return source.map((stop) => {
      const model = modelById.get(stop.stopId);
      const kind = routePlanKind(String(stop.stopType));
      if (kind === 'pickup') pickupN += 1;
      else if (kind === 'drop') dropN += 1;
      const caption =
        kind === 'drop'
          ? `Drop ${dropN}`
          : kind === 'pickup'
            ? `Pickup ${pickupN}`
            : `Stop ${stop.sequence}`;
      const orders = model?.orders ?? [];
      return {
        id: stop.stopId,
        caption,
        place: formatStopPlace(stop),
        address: [stop.addressLine, stop.city, stop.state].filter((part) => part?.trim()).join(', ') || null,
        kind,
        isCurrent: stop.stopId === currentId,
        orders: orders.map((order) => ({
          id: order.id,
          orderNumber: order.orderNumber,
          customerName: order.customer.name,
          lines: order.lines.map((line, index) => ({
            key: `${order.id}-${line.productId ?? line.sku ?? index}`,
            name: line.name?.trim() || line.sku?.trim() || `Product ${index + 1}`,
            sku: line.sku,
            quantity: line.quantity,
          })),
        })),
      };
    });
  }, [commerce.stops, stops, currentId]);

  useEffect(() => {
    if (deliveryDetailsNonce === seenDetailsNonce.current) return;
    seenDetailsNonce.current = deliveryDetailsNonce;
    if (deliveryDetailsNonce > 0) setDetailsOpen(true);
  }, [deliveryDetailsNonce]);
  const pay = isAggregateTrip(trip) || !(Number(commissionAmount) > 0)
    ? { earnings: DRIVER_PAY_NA_AMOUNT, earningsLabel: DRIVER_PAY_NA_LABEL }
    : { earnings: formatINR(Number(commissionAmount)), earningsLabel: 'EST. EARNINGS' };
  const etaLabel = (() => {
    const raw = trip.estimated_duration;
    if (raw != null && String(raw).trim() !== '' && !String(raw).includes('00:00:00')) {
      return formatEstimatedDuration(raw);
    }
    return '—';
  })();
  const missionTitle = !currentStop
    ? "Today's route"
    : isDeliveryStop(String(currentStop.stopType))
      ? currentStop.status === 'arrived' ? 'At drop' : 'Go to delivery'
      : currentStop.status === 'arrived' ? 'At pickup' : 'Go to pickup';
  const navigateTarget = currentStop
    ? (isDeliveryStop(String(currentStop.stopType)) ? 'drop' : 'pickup')
    : 'pickup';
  const navigateCoord = getTripStopCoordinate(trip, navigateTarget);

  const openStopDetails = (stop: DriverStopExecutionStop, review: boolean) => {
    const stopIndex = Math.max(1, stops.findIndex((s) => s.stopId === stop.stopId) + 1);
    setVerifySession({
      stop,
      orders: ordersOnStop(mission, stop.stopId),
      stopIndex,
      review,
    });
    setVerified(review && (stop.status === 'completed' || stop.status === 'skipped'));
    setVerificationOpen(true);
  };

  const openTimelineStop = (stopId: string) => {
    const stop = stops.find((item) => item.stopId === stopId);
    if (!stop) return;
    const confirmHere = sesReady && stop.stopId === currentId && stop.status === 'arrived';
    openStopDetails(stop, !confirmHere);
  };

  const openVerification = () => {
    if (!sesReady || !currentStop) return;
    openStopDetails(currentStop, false);
  };

  const closeVerification = () => {
    setVerificationOpen(false);
    setVerified(false);
    setVerifySession(null);
  };

  const applyTripOutcome = (command: DriverCommandResult | undefined) => {
    if (!command?.ok || !command.trip_status) return;
    if (command.trip_status === String(trip.status ?? '').toLowerCase()) return;
    onTripUpdated?.(applyDriverCommandResult(trip, command));
    if (command.trip_status === 'completed') setMarkedComplete(true);
  };

  const markDeliveryCompleted = () => {
    void (async () => {
      setCompletingTrip(true);
      setCompleteError(null);
      const { error, result } = await executeDriverCommand(
        { tripId: trip.id, command: 'COMPLETE_TRIP' },
        trip,
      );
      setCompletingTrip(false);
      if (error || !result) {
        const message = error?.message ?? 'Could not complete this delivery';
        setCompleteError(message);
        setActionError(message);
        return;
      }
      onTripUpdated?.(applyDriverCommandResult(trip, result));
      setMarkedComplete(true);
    })();
  };

  const runArrive = () => {
    if (!sesReady) {
      setActionError(ROUTE_SETUP_PENDING_MESSAGE);
      return;
    }
    void arrive().then((result) => {
      if (result.ignored) return;
      setActionError(result.ok ? null : result.error?.message ?? 'Could not arrive at this stop');
      if (result.ok) applyTripOutcome(result.command);
    });
  };
  const runComplete = (proof: DeliveryProofDraft) => {
    if (!sesReady) {
      setActionError(ROUTE_SETUP_PENDING_MESSAGE);
      return;
    }
    const stop = verifySession?.stop;
    const uid = profile?.uid;
    void (async () => {
      setProofBusy(true);
      try {
        if (stop) {
          if (!uid) {
            setActionError('Sign in is required to save stop proof');
            return;
          }
          let ledger = proofLedgersRef.current.get(stop.stopId);
          if (!ledger) {
            ledger = new Map();
            proofLedgersRef.current.set(stop.stopId, ledger);
          }
          const saved = await persistStopDeliveryProof({
            tripId: trip.id,
            stopId: stop.stopId,
            uploadedBy: uid,
            draft: proof,
            kind: isDeliveryStop(String(stop.stopType)) ? 'delivery' : 'pickup',
            ledger,
          });
          if (!saved.ok) {
            setActionError(saved.error.message);
            return;
          }
        }
        const result = await complete();
        if (result.ignored) return;
        if (!result.ok) {
          setActionError(result.error?.message ?? 'Could not finish this stop');
          return;
        }
        setActionError(null);
        setVerified(true);
        applyTripOutcome(result.command);
      } finally {
        setProofBusy(false);
      }
    })();
  };

  if (collapsed && !inSheet && !verificationOpen) {
    return (
      <>
      <Pressable
        testID="driver-multi-order-job-card"
        onPress={() => onToggleCollapse?.()}
        style={[sheetStyle, styles.peek]}
        accessibilityRole="button"
        accessibilityLabel="Open today's route"
      >
        <RouteProgressHeader
          colors={colors}
          done={done}
          total={stops.length}
          orderCount={orderCount}
          remainingKmLabel={remainingKmLabel}
          kicker="Commerce Delivery"
          summary={commerceSummary}
        />
        <RouteProgressTrack colors={colors} stops={stops} currentStopId={currentId} />
        {currentStop ? (
          <Text style={[styles.peekPlace, { color: colors.text }]} numberOfLines={1}>
            {formatStopPlace(currentStop)}
          </Text>
        ) : null}
        {actionModel.cta ? (
          <View style={[styles.peekCta, { backgroundColor: colors.emerald }]}>
            <Text style={[styles.peekCtaText, { color: colors.textOnPrimary }]}>
              {actionModel.cta}
            </Text>
          </View>
        ) : null}
        <View style={styles.peekHint}>
          <ChevronUp size={16} color={colors.emerald} strokeWidth={2.6} />
        </View>
        <Pressable
          onPress={() => setDetailsOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="View delivery details"
          style={[styles.detailsBtn, { backgroundColor: colors.emerald }]}
        >
          <Text style={[styles.detailsBtnText, { color: colors.textOnPrimary }]}>View details</Text>
        </Pressable>
      </Pressable>
      <DeliveryDetailsPreview
        visible={detailsOpen}
        stops={previewStops}
        onClose={() => setDetailsOpen(false)}
      />
      </>
    );
  }

  const nextOnRoute = verified ? currentStop : nextStop;
  const verifyOverlay =
    verificationOpen && verifySession ? (
      <DriverStopVerificationScreen
        stop={verifySession.stop}
        orders={mission ? ordersOnStop(mission, verifySession.stop.stopId) : verifySession.orders}
        stopIndex={verifySession.stopIndex}
        stopTotal={stops.length}
        ordersLoading={missionState.status === 'loading'}
        loadError={missionState.status === 'error' ? missionState.error.message : null}
        onRetryOrders={missionState.status === 'error' ? missionState.retry ?? null : null}
        retryingOrders={missionState.status === 'error' && missionState.retrying === true}
        busy={mutating === 'complete' || proofBusy}
        confirmed={verified}
        review={verifySession.review}
        nextStop={
          nextOnRoute && nextOnRoute.stopId !== verifySession.stop.stopId ? nextOnRoute : null
        }
        onBack={closeVerification}
        onConfirm={runComplete}
        onViewNextStop={closeVerification}
      />
    ) : null;

  const showHeroAssigner = Boolean(
    assignedBy && (assignedBy.linePrimary.trim() || assignedBy.lineSecondary.trim()),
  );
  const distanceLabel =
    distanceToTargetKm != null
      ? `${formatStopKm(distanceToTargetKm) ?? ''} to ${navigateTarget === 'drop' ? 'drop' : 'pickup'}`
      : '—';

  return (
    <View testID="driver-multi-order-job-card" style={sheetStyle}>
      {inSheet ? (
        <MissionCardLayout
          title={missionTitle}
          earnings={pay.earnings}
          earningsLabel={pay.earningsLabel}
          assignedBy={assignedBy}
          showHeroAssigner={showHeroAssigner}
          target={navigateTarget}
          pickupLabel={pickupLabel}
          dropLabel={dropLabel}
          planStops={missionPlan && missionPlan.length > 1 ? missionPlan : null}
          tripIdLabel={tripsService.resolveDriverFacingTripLabel(trip)}
          remainingKm={distanceToTargetKm ?? null}
          distanceLabel={distanceLabel.trim() || '—'}
          etaLabel={etaLabel}
          vehicleNumber={trip.vehicle_display_number}
          onNavigate={
            navigateCoord
              ? () => { void openExternalNavigation(navigateCoord.latitude, navigateCoord.longitude); }
              : null
          }
          onViewDetails={() => setDetailsOpen(true)}
        />
      ) : null}
      <View style={inSheet ? styles.sheetBody : null}>
      <RouteProgressHeader
        colors={colors}
        done={done}
        total={stops.length}
        orderCount={orderCount}
        remainingKmLabel={remainingKmLabel}
        onViewTripPlan={onShowRouteOnMap}
        kicker="Commerce Delivery"
        summary={commerceSummary}
        stats={stopStats}
      />

      {currentStop && !routeFinished ? (
        <CurrentStopCard
          colors={colors}
          stop={currentStop}
          orders={ordersOnStop(mission, currentStop.stopId)}
          ordersLoading={missionState.status === 'loading'}
          distanceKm={distanceToTargetKm}
          onOpenDetails={() => openTimelineStop(currentStop.stopId)}
          onNavigate={
            currentStop.latitude != null && currentStop.longitude != null
              ? () => { void openExternalNavigation(Number(currentStop.latitude), Number(currentStop.longitude)); }
              : null
          }
          onProof={canComplete ? openVerification : null}
        >
          <StopActionButton
            colors={colors}
            model={actionModel}
            nextPlace={sesReady && nextStop ? formatStopPlace(nextStop) : null}
            busy={mutating != null}
            mutating={mutating}
            onArrive={runArrive}
            onComplete={openVerification}
          />
        </CurrentStopCard>
      ) : (
        <View style={styles.doneBlock}>
          <Text style={[styles.doneHint, { color: colors.textMuted }]}>
            {tripCompleted ? 'Delivery completed.' : 'All stops on this route are done.'}
          </Text>
          <Pressable
            onPress={() => setSummaryOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={tripCompleted ? 'View delivery summary' : 'Review delivery summary'}
            style={[styles.summaryBtn, { borderColor: colors.emeraldBorder, backgroundColor: colors.emeraldMuted }]}
          >
            <Text style={[styles.summaryBtnText, { color: colors.emerald }]}>
              {tripCompleted ? 'View summary' : 'Review delivery summary'}
            </Text>
          </Pressable>
        </View>
      )}

      <RouteTimeline
        colors={colors}
        stops={timelineStops}
        onOpenStop={openTimelineStop}
        onViewAll={() => setDetailsOpen(true)}
      />

      {actionError ? (
        <Text style={[styles.error, { color: Theme.negative }]} accessibilityRole="alert">
          {actionError}
        </Text>
      ) : null}
      {verifyOverlay}
      </View>
      <DeliveryDetailsPreview
        visible={detailsOpen}
        stops={previewStops}
        onClose={() => setDetailsOpen(false)}
      />
      {summaryOpen ? (
        <DriverTripCompletionScreen
          stops={stops}
          mission={mission}
          tripCompleted={tripCompleted}
          busy={completingTrip}
          error={completeError}
          onBack={() => setSummaryOpen(false)}
          onMarkCompleted={markDeliveryCompleted}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    paddingHorizontal: TRIP_SHEET_BODY_PAD.horizontal,
    paddingTop: TRIP_SHEET_BODY_PAD.top,
    paddingBottom: TRIP_SHEET_BODY_PAD.bottom,
    borderTopLeftRadius: TRIP_SHEET_TOP_RADIUS,
    borderTopRightRadius: TRIP_SHEET_TOP_RADIUS,
    gap: TRIP_SHEET_BODY_PAD.gap,
    overflow: 'hidden',
  },
  sheetFlush: {
    paddingHorizontal: 0,
    paddingTop: 0,
  },
  sheetFill: {
    flexGrow: 1,
  },
  sheetBody: {
    paddingHorizontal: TRIP_SHEET_BODY_PAD.horizontal,
    paddingTop: 16,
    paddingBottom: TRIP_SHEET_BODY_PAD.bottom,
    gap: 12,
  },
  edge: { marginHorizontal: 0 },
  inset: { marginHorizontal: Layout.screenPaddingHorizontal },
  peek: { paddingBottom: 12, gap: 8 },
  peekPlace: {
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  peekCta: {
    minHeight: Layout.minTouchTargetSize,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  peekCtaText: {
    fontSize: 13,
    fontWeight: '700',
  },
  peekHint: {
    alignItems: 'center',
  },
  detailsBtn: {
    minHeight: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailsBtnText: {
    fontSize: 14,
    fontWeight: '800',
  },
  doneHint: {
    fontSize: 12,
    fontWeight: '600',
  },
  doneBlock: { gap: 8 },
  summaryBtn: {
    minHeight: Layout.minTouchTargetSize,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  summaryBtnText: {
    fontSize: 13,
    fontWeight: '700',
  },
  error: {
    fontSize: 12,
  },
});
