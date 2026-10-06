import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import { DriverJobCard } from '@/features/driver/job-card/DriverJobCard';
import type { DriverStopExecutionStop } from '@/features/driver/execution/driverStopExecution.types';
import type { TripRow } from '@/features/trips/services/trips.service';
import {
  GATE3_TRP011,
  GATE3_TRP049,
  GATE3_TRP051,
} from '@/features/trips/domain/__tests__/gate3CommerceOriginFixtures';

const mockUseDriverStopExecution = jest.fn();
const mockUseDriverCommerceMission = jest.fn();

jest.mock('react-native', () => jest.requireActual('react-native'));

jest.mock('@/components/driver/DriverTripSheetLayout', () => ({
  FLOW_EMERALD: '#059669',
  FLOW_EMERALD_DARK: '#047857',
  FLOW_MINT: '#a7f3d0',
  HERO_SIDE_ICON_SIZE: 34,
  TRIP_SHEET_TOP_RADIUS: 16,
  TRIP_SHEET_HERO_PAD: { top: 16, horizontal: 18, bottom: 14 },
  TRIP_SHEET_BODY_PAD: { horizontal: 18, top: 12, bottom: 10, gap: 8 },
  HeroAssignerBlock: () => null,
  HeroKindBadge: () => null,
}));

jest.mock('@/components/LoadingIndicator', () => ({
  LoadingIndicator: () => null,
}));

jest.mock('@/contexts/DriverThemeContext', () => {
  const colors = {
    background: '#f8fafc',
    surface: '#fff',
    surfaceElevated: '#f1f5f9',
    border: '#e2e8f0',
    text: '#0f172a',
    textMuted: '#64748b',
    textOnPrimary: '#fff',
    primary: '#059669',
    emerald: '#047857',
    emeraldMuted: 'rgba(4,120,87,0.12)',
    emeraldBorder: 'rgba(4,120,87,0.38)',
  };
  return {
    useDriverThemeColors: () => colors,
    getDriverThemeColors: () => colors,
  };
});

jest.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ profile: { uid: 'user-1' } }),
}));

jest.mock('@/features/driver/hooks/useDriverStopExecution', () => ({
  useDriverStopExecution: (...args: unknown[]) => mockUseDriverStopExecution(...args),
}));

jest.mock('@/features/driver/components/DriverTripFlowCard', () => {
  const { View } = require('react-native');
  return { DriverTripFlowCard: () => <View testID="legacy-job-card" /> };
});

jest.mock('@/features/driver/commerce-mission/useDriverCommerceMission', () => ({
  useDriverCommerceMission: (...args: unknown[]) => mockUseDriverCommerceMission(...args),
}));

jest.mock('@/features/trips/services/trips.service', () => ({
  resolveDriverFacingTripLabel: () => 'TRP001',
}));

function trip(): TripRow {
  return { id: 'trip-1' } as TripRow;
}

function stop(stopId: string): DriverStopExecutionStop {
  return {
    stopId,
    sequence: 1,
    stopType: 'pickup',
    displayName: 'Chennai Warehouse',
    addressLine: null,
    city: 'Chennai',
    state: null,
    pincode: null,
    latitude: null,
    longitude: null,
    contactName: null,
    contactPhone: null,
    podRequired: false,
    status: 'pending',
    driverId: null,
    arrivedAt: null,
    completedAt: null,
    skipReason: null,
    failureReason: null,
  };
}

function controller(overrides: Record<string, unknown>) {
  return {
    tripId: 'trip-1',
    stops: [],
    currentStop: null,
    nextStop: null,
    mutating: null,
    hydrated: true,
    arrive: jest.fn(),
    complete: jest.fn(),
    ...overrides,
  };
}

describe('DriverJobCard', () => {
  beforeEach(() => {
    mockUseDriverStopExecution.mockReset();
    mockUseDriverCommerceMission.mockReset();
    mockUseDriverCommerceMission.mockReturnValue({
      status: 'ready',
      mission: { tripId: 'trip-1', indentId: null, executionPlanId: null, stops: [] },
    });
  });

  it('keeps the accept-stage summary while SES is still hydrating', () => {
    mockUseDriverStopExecution.mockReturnValue(controller({ hydrated: false }));
    const { getByTestId, queryByTestId } = render(<DriverJobCard trip={trip()} />);
    expect(getByTestId('legacy-job-card')).toBeTruthy();
    expect(queryByTestId('driver-job-card-pending')).toBeNull();
    expect(mockUseDriverStopExecution).toHaveBeenCalledWith(null);
    expect(mockUseDriverCommerceMission).not.toHaveBeenCalled();
  });

  it('opens the multi-order card for a commerce trip before SES hydrates', () => {
    mockUseDriverStopExecution.mockReturnValue(controller({ hydrated: false }));
    const { getByTestId, queryByTestId } = render(
      <DriverJobCard trip={{ ...trip(), is_commerce: true }} />,
    );
    expect(getByTestId('driver-multi-order-job-card')).toBeTruthy();
    expect(queryByTestId('legacy-job-card')).toBeNull();
    expect(queryByTestId('driver-job-card-pending')).toBeNull();
    expect(mockUseDriverStopExecution).toHaveBeenCalledWith('trip-1');
  });

  it('renders the untouched legacy card when SES is empty and trip is not commerce', () => {
    mockUseDriverStopExecution.mockReturnValue(controller({ hydrated: true, stops: [] }));
    const { getByTestId, queryByTestId } = render(<DriverJobCard trip={trip()} />);
    expect(getByTestId('legacy-job-card')).toBeTruthy();
    expect(queryByTestId('driver-multi-order-job-card')).toBeNull();
    expect(mockUseDriverCommerceMission).not.toHaveBeenCalled();
  });

  it('does not use Primitive A to choose the card when SES is empty', () => {
    mockUseDriverStopExecution.mockReturnValue(controller({ hydrated: true, stops: [] }));
    mockUseDriverCommerceMission.mockReturnValue({
      status: 'ready',
      mission: {
        tripId: 'trip-1',
        indentId: 'indent-1',
        executionPlanId: 'plan-1',
        stops: [],
      },
    });
    const { getByTestId } = render(<DriverJobCard trip={trip()} />);
    expect(getByTestId('legacy-job-card')).toBeTruthy();
    expect(mockUseDriverCommerceMission).not.toHaveBeenCalled();
  });

  it('renders multi-order when trip.is_commerce even without SES', () => {
    mockUseDriverStopExecution.mockReturnValue(controller({ hydrated: true, stops: [] }));
    const { getByTestId, queryByTestId } = render(
      <DriverJobCard trip={{ ...trip(), is_commerce: true }} />,
    );
    expect(getByTestId('driver-multi-order-job-card')).toBeTruthy();
    expect(queryByTestId('legacy-job-card')).toBeNull();
  });

  it('keeps the FTL card when SES has stops but the trip is not Commerce', () => {
    const current = stop('s1');
    mockUseDriverStopExecution.mockReturnValue(controller({
      hydrated: true,
      stops: [current, { ...current, stopId: 's2', sequence: 2 }],
      currentStop: current,
    }));
    const { getByTestId, queryByTestId } = render(<DriverJobCard trip={trip()} />);
    expect(getByTestId('legacy-job-card')).toBeTruthy();
    expect(queryByTestId('driver-multi-order-job-card')).toBeNull();
    expect(mockUseDriverCommerceMission).not.toHaveBeenCalled();
  });

  it('renders multi-order from execution_plan_id and hydrates Primitive A once', async () => {
    mockUseDriverStopExecution.mockReturnValue(controller({ hydrated: true, stops: [] }));
    const { getByTestId, queryByTestId } = render(
      <DriverJobCard trip={{ ...trip(), execution_plan_id: 'plan-1' }} />,
    );
    expect(getByTestId('driver-multi-order-job-card')).toBeTruthy();
    expect(queryByTestId('legacy-job-card')).toBeNull();
    expect(mockUseDriverStopExecution).toHaveBeenCalledTimes(1);
    expect(mockUseDriverStopExecution).toHaveBeenCalledWith('trip-1');
    await waitFor(() => {
      expect(mockUseDriverCommerceMission).toHaveBeenCalledTimes(1);
      expect(mockUseDriverCommerceMission).toHaveBeenCalledWith('trip-1');
    });
  });

  it('routes TRP049 to Multi-Order', () => {
    mockUseDriverStopExecution.mockReturnValue(controller({ hydrated: true, stops: [] }));
    const { getByTestId, queryByTestId } = render(
      <DriverJobCard trip={{ ...trip(), ...GATE3_TRP049 }} />,
    );
    expect(getByTestId('driver-multi-order-job-card')).toBeTruthy();
    expect(queryByTestId('legacy-job-card')).toBeNull();
    expect(mockUseDriverStopExecution).toHaveBeenCalledWith(GATE3_TRP049.id);
    expect(mockUseDriverCommerceMission).toHaveBeenCalledWith(GATE3_TRP049.id);
  });

  it('routes TRP051 to Multi-Order', () => {
    mockUseDriverStopExecution.mockReturnValue(controller({ hydrated: true, stops: [] }));
    const { getByTestId, queryByTestId } = render(
      <DriverJobCard trip={{ ...trip(), ...GATE3_TRP051 }} />,
    );
    expect(getByTestId('driver-multi-order-job-card')).toBeTruthy();
    expect(queryByTestId('legacy-job-card')).toBeNull();
    expect(mockUseDriverStopExecution).toHaveBeenCalledWith(GATE3_TRP051.id);
    expect(mockUseDriverCommerceMission).toHaveBeenCalledWith(GATE3_TRP051.id);
  });

  it('routes TRP011 at_drop without a plan to FTL', () => {
    mockUseDriverStopExecution.mockReturnValue(controller({ hydrated: true, stops: [] }));
    const { getByTestId, queryByTestId } = render(
      <DriverJobCard trip={{ ...trip(), ...GATE3_TRP011 }} />,
    );
    expect(getByTestId('legacy-job-card')).toBeTruthy();
    expect(queryByTestId('driver-multi-order-job-card')).toBeNull();
    expect(mockUseDriverStopExecution).toHaveBeenCalledWith(null);
    expect(mockUseDriverCommerceMission).not.toHaveBeenCalled();
  });

  it('does not choose Multi-Order from stops, orders, products, or at_drop alone', () => {
    mockUseDriverStopExecution.mockReturnValue(controller({
      hydrated: true,
      stops: [stop('s1'), { ...stop('s2'), stopId: 's2', sequence: 2 }],
    }));
    const lookalike = {
      ...trip(),
      status: 'at_drop',
      stops: 4,
      orders: 6,
      products: [{ id: 'p1' }],
    } as TripRow;
    const { getByTestId, queryByTestId } = render(<DriverJobCard trip={lookalike} />);
    expect(getByTestId('legacy-job-card')).toBeTruthy();
    expect(queryByTestId('driver-multi-order-job-card')).toBeNull();
  });

  it('keeps Multi-Order when Commerce SES is empty and does not fall back to FTL', () => {
    mockUseDriverStopExecution.mockReturnValue(controller({ hydrated: true, stops: [] }));
    const { getByTestId, queryByTestId } = render(
      <DriverJobCard trip={{ ...trip(), is_commerce: true, execution_plan_id: 'plan-1' }} />,
    );
    expect(getByTestId('driver-multi-order-job-card')).toBeTruthy();
    expect(queryByTestId('legacy-job-card')).toBeNull();
    expect(mockUseDriverCommerceMission).toHaveBeenCalledTimes(1);
  });
});
