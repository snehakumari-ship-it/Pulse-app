import type { DriverStopExecutionStop } from "@/features/driver/execution/driverStopExecution.types";
import type { TripRow } from "@/features/trips/services/trips.service";
import { formatTrackingDateTime } from "@/features/trips/utils/formatTrackingTimestamp.util";
import {
  MANIFEST_PULSE_LAST_INDEX,
  type ManifestJourneyLogEntry,
} from "@/features/trips/utils/manifestJourneyLog.util";

/**
 * Commerce (multi-order) manifest journey, driven by stop_execution_state:
 * the first stop is Loading, every stop in between is part of In-Transit,
 * the last stop is Unloading, and finishing it completes the trip.
 */

const DONE: ReadonlySet<string> = new Set(["completed", "skipped", "failed"]);

export function isCommerceJourney(stops: readonly DriverStopExecutionStop[]): boolean {
  return stops.length >= 2;
}

function ordered(stops: readonly DriverStopExecutionStop[]): DriverStopExecutionStop[] {
  return [...stops].sort((a, b) => a.sequence - b.sequence);
}

function stopPlace(stop: DriverStopExecutionStop): string {
  const city = [stop.city, stop.state].filter(Boolean).join(", ");
  return stop.addressLine
    ? `${stop.displayName} · ${stop.addressLine}`
    : city
      ? `${stop.displayName} · ${city}`
      : stop.displayName;
}

function timeLabel(iso: string | null): string {
  return iso ? formatTrackingDateTime(iso) : "—";
}

function stopVerb(stop: DriverStopExecutionStop): string {
  return stop.stopType === "pickup" ? "Pickup" : "Drop";
}

function stopProgressLine(stop: DriverStopExecutionStop, index: number): string {
  const state =
    stop.status === "completed"
      ? `done ${timeLabel(stop.completedAt)}`
      : stop.status === "skipped"
        ? "skipped"
        : stop.status === "failed"
          ? "failed"
          : stop.status === "arrived"
            ? `arrived ${timeLabel(stop.arrivedAt)}`
            : "pending";
  return `${index + 2}. ${stopVerb(stop)} · ${stop.displayName} — ${state}`;
}

/** Last fully reached commerce step (0–5), same scale as the FTL manifest. */
export function getCommerceManifestStepIndex(
  trip: Pick<TripRow, "status" | "completed_at">,
  stops: readonly DriverStopExecutionStop[],
  ftlStepIndex: number,
): number {
  const list = ordered(stops);
  const first = list[0];
  const last = list[list.length - 1];
  if (!first || !last) return ftlStepIndex;

  const status = String(trip.status ?? "").toLowerCase();
  if (
    trip.completed_at ||
    ["completed", "delivered", "done"].includes(status) ||
    DONE.has(last.status)
  ) {
    return MANIFEST_PULSE_LAST_INDEX;
  }
  if (last.status === "arrived") return 4;
  if (DONE.has(first.status)) return 3;
  if (first.status === "arrived") return 2;
  return Math.min(ftlStepIndex, 2);
}

/**
 * Replaces the FTL pickup / transit / drop rows with stop-driven rows.
 * `ftlLogs` supplies the Assigned and Driver Accepted rows unchanged.
 */
export function buildCommerceManifestJourneyLogs(input: {
  trip: Pick<TripRow, "completed_at">;
  stops: readonly DriverStopExecutionStop[];
  ftlLogs: readonly ManifestJourneyLogEntry[];
}): ManifestJourneyLogEntry[] {
  const list = ordered(input.stops);
  const first = list[0]!;
  const last = list[list.length - 1]!;
  const between = list.slice(1, -1);

  const head = input.ftlLogs.filter(
    (log) => log.stepKey === "assigned" || log.stepKey === "driver_accepted",
  );

  const loadingDone = DONE.has(first.status);
  const loading: ManifestJourneyLogEntry = {
    stepKey: "loading",
    status: loadingDone ? "Loaded" : "Loading",
    atIso: first.arrivedAt ?? first.completedAt,
    time: timeLabel(first.arrivedAt ?? first.completedAt),
    location: stopPlace(first),
    details: loadingDone
      ? `Loading finished at ${first.displayName} ${timeLabel(first.completedAt)}.`
      : `Driver is loading at ${first.displayName}.`,
  };

  const betweenDone = between.filter((s) => DONE.has(s.status)).length;
  const nextStop = list.find((s) => !DONE.has(s.status)) ?? last;
  const transitSummary =
    between.length === 0
      ? `Heading to ${last.displayName}.`
      : `${betweenDone} of ${between.length} en-route stop${between.length === 1 ? "" : "s"} done · Next: ${nextStop.displayName}.`;
  const inTransit: ManifestJourneyLogEntry = {
    stepKey: "in_transit",
    status: "In-Transit",
    atIso: first.completedAt,
    time: timeLabel(first.completedAt),
    location:
      between.length === 0
        ? `En route to ${last.displayName}`
        : `${between.length} stop${between.length === 1 ? "" : "s"} en route · Next: ${nextStop.displayName}`,
    details: [transitSummary, ...between.map(stopProgressLine)].join("\n"),
  };

  const unloadingDone = DONE.has(last.status);
  const unloading: ManifestJourneyLogEntry = {
    stepKey: "unloading",
    status: unloadingDone ? "Unloaded" : "Unloading",
    atIso: last.arrivedAt,
    time: timeLabel(last.arrivedAt),
    location: stopPlace(last),
    details: unloadingDone
      ? `Unloading finished at ${last.displayName}.`
      : `Driver is unloading at ${last.displayName}.`,
  };

  const completedAt = last.completedAt ?? input.trip.completed_at ?? null;
  const completed: ManifestJourneyLogEntry = {
    stepKey: "delivered",
    status: "Completed",
    atIso: completedAt,
    time: timeLabel(completedAt),
    location: stopPlace(last),
    details: `All ${list.length} stops finished. Trip completed.`,
  };

  return [...head, loading, inTransit, unloading, completed];
}
