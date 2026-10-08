/**
 * Add Trip — shared types for form data and modal props.
 * Only 2 Source of Supply: Asset (Own Fleet) | Aggregate (Associated Partner).
 */

import type {
  RouteExtraStopDraft,
  RouteExtraStopInput,
} from "@/features/trips/utils/routeExtraStops.util";

export type SupplySource = 'asset' | 'aggregate';

/** Market branch after Source: known partner trip vs indent bidding. */
export type MarketFulfillment = "supplier" | "bid";

export interface AddTripFormData {
  pickup_area: string;
  drop_location: string;
  /** Planned trip start date (YYYY-MM-DD). Stored in trips.pickup_date. */
  pickup_date?: string | null;
  /** Optional coordinates from place search (for maps/distance when backend supports). */
  pickup_lat?: number | null;
  pickup_lon?: number | null;
  drop_lat?: number | null;
  drop_lon?: number | null;
  /** Pre-calculated route distance (km). Persisted into trips.distance (numeric). */
  distance?: number | null;
  /**
   * Pre-calculated route ETA stored as an interval-compatible string (HH:MM:SS).
   * This will be rendered by driver UI.
   */
  estimated_duration?: string | null;
  client_name: string;
  client_id?: string | null;
  client_price: number;
  sale_rate_basis?: "per_mt" | "per_trip";
  sale_unit_rate?: number | null;
  lane_id?: string | null;
  indent_id?: string | null;
  supplier_rate: number;
  supplier_id?: string | null;
  /** Denormalized partner label for lists/detail when supplier_id is set. */
  supplier_name?: string | null;
  /** Advance paid to partner (aggregate only). Optional; can be recorded as ledger after create. */
  advance_paid?: number;
  notes?: string | null;
  driver_id?: string | null;
  /** Resolved from driver record when driver is selected — stamped onto trips.driver_commission at creation. */
  driver_commission_percent?: number | null;
  driver_commission_per_km?: number | null;
  vehicle_id?: string | null;
  /** Aggregate only: vehicle number for display (persisted as trip.vehicle_display_number). */
  vehicle_display_number?: string | null;
  /** Optional load weight in tons; stored in trips.load_tons. */
  tons?: string | null;
  /** Cargo / product type (trips.load_type). */
  load_type?: string | null;
  /** Requested vehicle type (stored in trip notes when no vehicle_id). */
  vehicle_type?: string | null;
  /** Stops between pickup and drop; createTrip adds their charges to the freight. */
  extra_stops?: RouteExtraStopInput[];
}

export interface AddTripFormState {
  pickupArea: string;
  dropLocation: string;
  /** FTL stops between pickup and drop ("Add stop"). */
  extraStops: RouteExtraStopDraft[];
  /** Planned trip start date (YYYY-MM-DD). */
  tripStartDate: string;
  /** Optional load weight in tons as text input. */
  tons: string;
  vehicleType: string;
  loadType: string;
  pickupLat: number | null;
  pickupLon: number | null;
  dropLat: number | null;
  dropLon: number | null;
  /** Calculated route stats (for display + persistence). */
  routeDistanceKm: number | null;
  routeEtaInterval: string | null;
  routeEtaLabel: string | null;
  routeLoading: boolean;
  clientName: string;
  clientId: string | null;
  clientPrice: string;
  saleRateBasis: "per_mt" | "per_trip";
  saleUnitRate: string;
  laneId: string | null;
  supplierRate: string;
  supplySource: SupplySource;
  /**
   * Set after Source = Market. `supplier` → createTrip with partner rate.
   * `bid` → createIndent (not persisted until Share).
   */
  marketFulfillment: MarketFulfillment | null;
  /** Indent share destination — not the trip supplier_rate. */
  circulationTarget: "integrated_supplier" | "marketplace" | "both";
  /** Supplier target rate for bidding (createIndent.supplier_target). */
  supplierTarget: string;
  supplierRateBasis: "per_mt" | "per_trip";
  supplierId: string | null;
  /** Display name for chosen supplier (UI; name comes from suppliers row / joins, not always a trips column). */
  supplierDisplayName: string;
  advancePaid: string;
  assignLater: boolean;
  notes: string;
  driverId: string | null;
  driverCommissionPercent: number | null;
  driverCommissionPerKm: number | null;
  vehicleId: string | null;
  /** Aggregate only: assign driver for tracking by phone (used after createTrip). */
  driverPhone: string;
  /** Aggregate only: dispatcher-entered driver name for tracking (stored in trip notes). */
  aggregateDriverName: string;
  /** Display name from phone lookup (aggregate). */
  driverPhoneName: string | null;
  /** When `driverPhoneName` is present, require explicit user confirmation. */
  driverPhoneConfirmed: boolean;
  /** Aggregate: phone lookup matched a driver who is already on another active trip. */
  driverPhoneTripConflict: boolean;
  /** Trip label from availability check (e.g. display trip id) when `driverPhoneTripConflict`. */
  driverPhoneTripConflictLabel: string | null;
  /** Aggregate only: optional vehicle as text (stored in trip notes). */
  aggregateVehicleText: string;
  /**
   * Aggregate only: dispatcher-entered driver commission % as raw text.
   * Kept as a string because it is a free-text input; `driverCommissionPercent`
   * stays reserved for the number copied off a selected fleet driver row.
   */
  aggregateDriverCommissionPercent: string;
}

/** Optional context passed to onComplete for post-create actions (e.g. assign driver by phone). */
export interface AddTripCompleteOptions {
  supplySource: SupplySource;
  /** When set with supplySource === 'aggregate', assign this trip to driver by phone after create. */
  driverPhone?: string;
  /** Dispatcher-entered name for assign-by-phone (required when driverPhone is set). */
  driverName?: string;
}

/** Result when create returns OTP (aggregate trip). */
export interface AddTripSuccessDetails {
  tripNumber: string;
  routeLabel: string;
}

/** Snapshot for OTP success UI (filled client-side in AddTripModal). */
export interface AddTripOtpScreenContext {
  driverName?: string;
  driverPhone?: string;
  vehicleNumber?: string;
  pickupArea: string;
  dropLocation: string;
  clientName?: string;
  tons?: string;
  supplierDisplayName?: string;
  routeLine?: string;
}

export interface AddTripCompleteResult {
  trip: { id: string; vehicle_display_number?: string | null };
  otp: { code: string; expires_at: string } | null;
  successDetails?: AddTripSuccessDetails;
  /** Route/driver chips on the post-create OTP screen. */
  otpScreenContext?: AddTripOtpScreenContext;
}

/** When creating a trip from an indent, seed route + commodity from this row. */
export type AddTripSourceIndent = {
  id: string;
  pickup_area: string;
  drop_location: string;
  pickup_date?: string | null;
  weight?: number | null;
  vehicle_type?: string | null;
  load_type?: string | null;
  client_name?: string;
  client_price?: number;
  client_id?: string | null;
  lane_id?: string | null;
  sale_rate_basis?: "per_mt" | "per_trip" | null;
  sale_unit_rate?: number | null;
};

export interface AddTripShareIndentResult {
  created: true;
}

export interface AddTripModalProps {
  organizationId: string | null;
  sourceIndent?: AddTripSourceIndent | null;
  onClose: () => void;
  /** Called on submit. May return { trip, otp } for aggregate so modal shows OTP card. */
  onComplete: (
    data: AddTripFormData,
    options?: AddTripCompleteOptions
  ) => void | Promise<void> | Promise<AddTripCompleteResult | void>;
  /**
   * Market → Share for Bidding. Caller must create the indent and navigate.
   * Modal does not call onClose after success (navigation is the caller's job).
   */
  onShareIndent?: (
    data: import("@/features/indents/services/indents.service").CreateIndentInput,
  ) => Promise<AddTripShareIndentResult | void>;
}
