import type { DriverSesJoinRow } from '@/features/driver/execution/driverStopExecution.types';
import type { DriverStopExecutionBundle } from '@/features/driver/execution/driverStopExecution.types';
import { fetchDriverStopExecution } from '@/features/driver/execution/fetchDriverStopExecution';
import type { DriverStopTransition } from '@/features/driver/execution/resolveDriverStopTransition';
import {
  executeDriverCommand,
  type DriverCommandResult,
} from '@/features/driver/services/driverExecution.service';

export type TransitionDriverStopResult =
  | {
      ok: true;
      kind: 'applied' | 'idempotent';
      row: DriverSesJoinRow;
      refetchedBundle: DriverStopExecutionBundle | null;
      command: DriverCommandResult;
    }
  | {
      ok: false;
      error: Error;
      refetchedBundle: DriverStopExecutionBundle | null;
      command: DriverCommandResult | null;
    };

/**
 * ARRIVE_STOP / COMPLETE_STOP through driver_execute_command. The server owns
 * stop order, POD, timestamps, and the trip transitions they imply (start on the
 * first arrival, completion on the final stop).
 */
export async function transitionDriverStopExecution(input: {
  tripId: string;
  stopId: string;
  transition: DriverStopTransition;
  commandId?: string;
}): Promise<TransitionDriverStopResult> {
  const { tripId, stopId, transition } = input;
  if (!tripId || !stopId) {
    return { ok: false, error: new Error('Missing trip or stop'), refetchedBundle: null, command: null };
  }

  const { error, result } = await executeDriverCommand({
    tripId,
    command: transition === 'arrive' ? 'ARRIVE_STOP' : 'COMPLETE_STOP',
    commandId: input.commandId,
    payload: { stop_id: stopId },
  });

  const stop = result?.ok ? result.stop : undefined;
  if (!error && result && stop?.trip_id) {
    return {
      ok: true,
      kind: result.applied === false ? 'idempotent' : 'applied',
      row: {
        trip_id: stop.trip_id,
        stop_id: stop.stop_id,
        sequence: stop.sequence ?? 0,
        status: stop.status,
        driver_id: stop.driver_id ?? null,
        arrived_at: stop.arrived_at ?? null,
        completed_at: stop.completed_at ?? null,
        skip_reason: stop.skip_reason ?? null,
        failure_reason: stop.failure_reason ?? null,
      },
      refetchedBundle: null,
      command: result,
    };
  }

  const refetch = await fetchDriverStopExecution(tripId);
  return {
    ok: false,
    error: error ?? new Error('Could not update this stop'),
    refetchedBundle: refetch.ok ? refetch.bundle : null,
    command: result,
  };
}
