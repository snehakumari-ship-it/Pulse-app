/**
 * Gate 3 observed origin — not inferred from stops/orders/status.
 * Rows are read-only snapshots of linked Commerce/FTL fixtures.
 */
export const GATE3_TRP049 = {
  id: '3ed5a3df-97be-4c97-a13a-63092b6139ff',
  trip_number: 'TRP049',
  status: 'completed',
  is_commerce: true,
  execution_plan_id: 'd3e54564-da3f-40a3-beee-5cf779f5b6c9',
} as const;

export const GATE3_TRP051 = {
  id: '3f333e5b-1256-4208-acee-7de3bc305f0b',
  trip_number: 'TRP051',
  status: 'completed',
  is_commerce: true,
  execution_plan_id: '51000671-157b-4571-a157-5559b8934add',
} as const;

/** Live at_drop FTL trip. No execution_plan_id — must stay FTL. */
export const GATE3_TRP011 = {
  id: 'c05d2e54-f822-4e57-a2a4-f348be967378',
  trip_number: 'TRP011',
  status: 'at_drop',
  is_commerce: false,
  execution_plan_id: null,
} as const;
