import React from 'react';
import { render } from '@testing-library/react-native';
import { MissionCardLayout } from '@/features/driver/components/MissionCardLayout';
import { planStopsFromLabeled } from '@/features/driver/components/missionPlanRows';

jest.mock('react-native', () => jest.requireActual('react-native'));

jest.mock('lucide-react-native', () => new Proxy({}, {
  get: (_t, prop) => (prop === '__esModule' ? false : 'Icon'),
}));

jest.mock('expo-linear-gradient', () => {
  const { View } = jest.requireActual('react-native');
  return { LinearGradient: View };
});

const base = {
  title: 'Go to pickup',
  earnings: '₹2,400',
  earningsLabel: 'EST. EARNINGS',
  assignedBy: null,
  showHeroAssigner: false,
  target: 'pickup' as const,
  pickupLabel: 'Guindy Industrial Estate, Chennai',
  dropLabel: 'Sriperumbudur SIPCOT, Kanchipuram',
  tripIdLabel: 'TRP-0142',
  distanceLabel: '12.4 km to pickup',
  etaLabel: '1h 10m',
};

describe('MissionCardLayout header', () => {
  it('FTL (no plan stops) keeps the single route title with the trip code beneath', () => {
    const view = render(<MissionCardLayout {...base} />);
    expect(
      view.getByText('Guindy Industrial Estate, Chennai → Sriperumbudur SIPCOT, Kanchipuram'),
    ).toBeTruthy();
    expect(view.getByText('TRP-0142')).toBeTruthy();
    expect(view.queryByText('Pickup')).toBeNull();
    expect(view.queryByText(/next/)).toBeNull();
    expect(view.queryByLabelText('View delivery details')).toBeNull();
  });

  it('Commerce (plan stops) shows one row per stop and the details chip', () => {
    const planStops = planStopsFromLabeled([
      { id: 'pu', sequence: 1, type: 'pickup', place: 'Guindy Warehouse', isCurrent: false },
      { id: 'd1', sequence: 2, type: 'drop', place: 'Anna Nagar', isCurrent: true },
      { id: 'd2', sequence: 3, type: 'drop', place: 'Adyar', isCurrent: false },
    ]);
    const onViewDetails = jest.fn();
    const view = render(
      <MissionCardLayout {...base} planStops={planStops} onViewDetails={onViewDetails} />,
    );
    expect(
      view.queryByText('Guindy Industrial Estate, Chennai → Sriperumbudur SIPCOT, Kanchipuram'),
    ).toBeNull();
    expect(view.getByText(/Anna Nagar/)).toBeTruthy();
    expect(view.getByLabelText('View delivery details')).toBeTruthy();
  });
});
