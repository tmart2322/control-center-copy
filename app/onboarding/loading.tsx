// Loading fallback for /onboarding: the route's data-free skeleton (src/components/shell/RouteSkeleton.tsx picks it by pathname).
import { RouteLoading } from '@/components/shell/RouteSkeleton';

export default function Loading() {
  return <RouteLoading />;
}
