/**
 * Driver Home.
 *
 * The available surface (You're available / Find Work) is the DCO flow only.
 * Server operating mode is the gate — not "no fleet membership". A plain
 * independent DRIVER and a fleet employee stay on the trip home. A DCO with
 * an active trip stays on the trip home too. While mode or availability is
 * still loading, stay on the trip home so the DCO surface never flashes for
 * the wrong login.
 */
import { useAuth } from '@/contexts/AuthContext';
import DriverAvailableScreen from '@/features/drivers/screens/DriverAvailableScreen';
import DriverHomeScreen from '@/features/drivers/screens/DriverHomeScreen';
import { useDriverAvailabilityQuery } from '@/lib/queries/useDriverAvailabilityQuery';
import { useDriverOperatingModeQuery } from '@/lib/queries/useDriverOperatingModeQuery';

export default function DriverIndexRoute() {
  const { profile } = useAuth();
  const uid = profile?.uid ?? '';
  const { isDco, modeLoading } = useDriverOperatingModeQuery(uid);
  const { available, isLoading: availabilityLoading, isError: availabilityError } =
    useDriverAvailabilityQuery(uid);

  const showAvailableSurface =
    !modeLoading &&
    isDco &&
    !availabilityLoading &&
    !availabilityError &&
    available === true;

  return showAvailableSurface ? <DriverAvailableScreen /> : <DriverHomeScreen />;
}
