import { RouteSkeleton } from '@/components/schedule/RouteSkeleton';

export default function Loading() {
  return <RouteSkeleton variant="calendar" message="Loading the race calendar" />;
}
