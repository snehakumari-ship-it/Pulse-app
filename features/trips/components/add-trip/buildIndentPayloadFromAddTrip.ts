import { computeClientPrice } from "@/features/clients/utils/saleRateSnapshot.util";
import type { CreateIndentInput } from "@/features/indents/services/indents.service";
import { routeExtraStopInputs } from "@/features/trips/utils/routeExtraStops.util";

import type { AddTripFormState } from "./types";

function parseAmount(raw: string): number {
  const n = parseFloat(String(raw ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Map unified Add wizard state onto createIndent() fields.
 * Sale value stays client_price / sale_*; bidding rate is supplier_target.
 * Weight is stored in kg (tons × 1000), same as Create Load.
 */
export function buildIndentPayloadFromAddTripState(
  state: AddTripFormState,
  ids?: { ownerUserId?: string; createdByUserId?: string },
): CreateIndentInput {
  const unitRate = parseAmount(state.saleUnitRate);
  const tonsNum = parseAmount(state.tons);
  const clientPrice =
    state.saleRateBasis === "per_mt"
      ? computeClientPrice({
          basis: "per_mt",
          unitRate,
          tons: tonsNum,
        })
      : parseAmount(state.clientPrice);

  const payload: CreateIndentInput = {
    pickup_area: state.pickupArea.trim(),
    drop_location: state.dropLocation.trim(),
    client_name: state.clientName.trim(),
    client_price: clientPrice,
    sale_rate_basis: state.saleRateBasis,
    sale_unit_rate:
      state.saleRateBasis === "per_mt" && unitRate > 0 ? unitRate : null,
    lane_id: state.laneId,
    supplier_target: parseAmount(state.supplierTarget),
    supplier_rate_basis: state.supplierRateBasis,
    vehicle_type: state.vehicleType.trim(),
    load_type: state.loadType.trim(),
    // Per-MT loads may be shared before the weight is known (it is measured at
    // loading), so send null rather than a fabricated 0 kg.
    weight: tonsNum > 0 ? tonsNum * 1000 : null,
    pickup_date: state.tripStartDate.trim() || null,
    circulation_target: state.circulationTarget,
    owner_user_id: ids?.ownerUserId,
    created_by_user_id: ids?.createdByUserId,
  };
  if (state.clientId) payload.client_id = state.clientId;
  const extraStops = routeExtraStopInputs(state.extraStops);
  if (extraStops.length > 0) payload.extraStops = extraStops;
  return payload;
}
