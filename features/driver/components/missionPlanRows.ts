export type MissionPlanKind = 'pickup' | 'drop' | 'other';

export type MissionPlanStop = {
  key: string;
  kind: MissionPlanKind;
  caption: string;
  place: string;
  isCurrent?: boolean;
};

type LabeledStop = {
  id: string;
  sequence: number;
  type: string;
  place: string;
  isCurrent?: boolean;
};

function kindOf(type: string): MissionPlanKind {
  const t = type.trim().toLowerCase();
  if (t === 'pickup') return 'pickup';
  if (t === 'drop') return 'drop';
  return 'other';
}

function captionFor(kind: MissionPlanKind, index: number, sequence: number): string {
  if (kind === 'drop') return `Drop ${index}`;
  if (kind === 'pickup') return `Pickup ${index}`;
  return `Stop ${sequence}`;
}

function usablePlace(place: string): string | null {
  const trimmed = place.trim();
  if (!trimmed || trimmed === '—') return null;
  return trimmed;
}

/** Number pickups and drops separately so a second delivery is Drop 2. */
export function planStopsFromLabeled(stops: readonly LabeledStop[]): MissionPlanStop[] {
  let pickupN = 0;
  let dropN = 0;
  const rows: MissionPlanStop[] = [];
  const ordered = [...stops].sort((a, b) => a.sequence - b.sequence);
  for (const stop of ordered) {
    const place = usablePlace(stop.place);
    if (!place) continue;
    const kind = kindOf(stop.type);
    if (kind === 'pickup') pickupN += 1;
    else if (kind === 'drop') dropN += 1;
    const index = kind === 'drop' ? dropN : kind === 'pickup' ? pickupN : stop.sequence;
    rows.push({
      key: stop.id,
      kind,
      caption: captionFor(kind, index, stop.sequence),
      place,
      isCurrent: stop.isCurrent,
    });
  }
  return rows;
}

/**
 * Prefer the real stop list. Otherwise split the single pickup/drop line
 * so the destination is not clipped beside the date.
 */
export function missionPlanRows(
  pickupLabel: string,
  dropLabel: string,
  planStops?: readonly MissionPlanStop[] | null,
): readonly MissionPlanStop[] {
  if (planStops && planStops.length > 0) return planStops;
  const rows: MissionPlanStop[] = [];
  const pickup = usablePlace(pickupLabel);
  const drop = usablePlace(dropLabel);
  if (pickup) {
    rows.push({ key: 'pickup', kind: 'pickup', caption: 'Pickup', place: pickup });
  }
  if (drop) {
    rows.push({ key: 'drop', kind: 'drop', caption: 'Drop', place: drop });
  }
  return rows;
}

/** Current stop, then one line for whatever comes after. */
export function summarizePlanRows(rows: readonly MissionPlanStop[]): MissionPlanStop[] {
  if (rows.length <= 1) return [...rows];
  const found = rows.findIndex((row) => row.isCurrent);
  const focus = found >= 0 ? found : 0;
  const current = rows[focus] ?? rows[0]!;
  const upcoming = rows.slice(focus + 1);
  const next = upcoming[0];
  if (!next) return [current];
  return [
    current,
    {
      key: `${next.key}-next`,
      kind: next.kind,
      caption: `+${upcoming.length} next`,
      place: [next.caption, next.place].filter(Boolean).join(' · '),
    },
  ];
}
