/**
 * Driver Job Card router.
 *
 * Commerce vs FTL is `isCommerceDriverTrip` only (`is_commerce` or
 * `execution_plan_id`). Stop count, order count, products, status, route
 * shape, and SES do not choose the card. Primitive A is not used to choose
 * the card. SES hydrates only after Commerce is selected.
 */
import { DriverTripFlowCard, type DriverTripFlowCardProps } from '@/features/driver/components/DriverTripFlowCard';
import { useDriverStopExecution } from '@/features/driver/hooks/useDriverStopExecution';
import { DriverMultiOrderJobCard } from '@/features/driver/job-card/DriverMultiOrderJobCard';
import { isCommerceDriverTrip } from '@/features/trips/domain/driverTripExperience';

export function DriverJobCard(props: DriverTripFlowCardProps) {
  const isCommerceTrip = isCommerceDriverTrip(props.trip);
  const stopExecution = useDriverStopExecution(isCommerceTrip ? props.trip.id : null);

  if (isCommerceTrip) {
    return <DriverMultiOrderJobCard {...props} stopExecution={stopExecution} />;
  }

  return <DriverTripFlowCard {...props} skipStopExecution />;
}
