/**
 * Driver vs DCO operating mode for the signed-in person — server-resolved.
 * Backend: supabase/migrations/20271005120000_dco_operating_model_boundary.sql
 */
import { supabase } from '@/lib/supabase';
import {
  parseDriverOperatingMode,
  type DriverOperatingMode,
} from '@/features/drivers/domain/driverOperatingMode';

export async function getMyDriverOperatingMode(): Promise<{
  error: Error | null;
  mode: DriverOperatingMode | null;
}> {
  const { data, error } = await supabase().rpc('get_my_driver_operating_mode');
  if (error) return { error: new Error(error.message), mode: null };
  return { error: null, mode: parseDriverOperatingMode(data) };
}
