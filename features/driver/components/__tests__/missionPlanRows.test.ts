import { missionPlanRows, planStopsFromLabeled, summarizePlanRows } from '@/features/driver/components/missionPlanRows';

describe('planStopsFromLabeled', () => {
  it('numbers a second drop independently of pickup', () => {
    const rows = planStopsFromLabeled([
      { id: 'p', sequence: 1, type: 'pickup', place: 'Warehouse, Chennai, Tamil Nadu' },
      { id: 'd1', sequence: 2, type: 'drop', place: 'T Nagar' },
      { id: 'd2', sequence: 3, type: 'drop', place: 'Adyar, Chennai' },
    ]);
    expect(rows.map((row) => row.caption)).toEqual(['Pickup 1', 'Drop 1', 'Drop 2']);
    expect(rows[2]?.place).toBe('Adyar, Chennai');
  });
});

describe('missionPlanRows', () => {
  it('keeps pickup and drop on separate rows when no stop list exists', () => {
    expect(
      missionPlanRows('Warehouse, Chennai, Tamil Nadu', 'Adyar').map((row) => row.place),
    ).toEqual(['Warehouse, Chennai, Tamil Nadu', 'Adyar']);
  });

  it('uses the stop list so drop 2 is not folded into one line', () => {
    const rows = missionPlanRows('ignored', 'ignored', [
      { key: 'a', kind: 'pickup', caption: 'Pickup 1', place: 'Chennai' },
      { key: 'b', kind: 'drop', caption: 'Drop 1', place: 'T Nagar', isCurrent: true },
      { key: 'c', kind: 'drop', caption: 'Drop 2', place: 'Adyar' },
    ]);
    expect(rows.map((row) => row.caption)).toEqual(['Pickup 1', 'Drop 1', 'Drop 2']);
    expect(summarizePlanRows(rows)).toEqual([
      expect.objectContaining({ caption: 'Drop 1', place: 'T Nagar' }),
      expect.objectContaining({ caption: '+1 next', place: 'Drop 2 · Adyar' }),
    ]);
  });
});
