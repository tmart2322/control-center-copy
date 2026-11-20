// Every in-frame page (ROUTER) renders here, from the URL, in the browser's own router (ClientRouter.tsx; route table in
// src/components/shell/routes.ts). A tab switch is a history.pushState, never a server round-trip.
//
// The router lives in this layout, not in the catch-all page below it: the layout's segment never changes, so a
// router.refresh or a dev HMR refresh (which re-fetches the current URL) swaps only the empty page segment and the
// mounted page keeps its state. `[[...path]]/page.tsx` sets the title and applies legacy redirects on a full load.
//
// Own routes stay outside this group: app/onboarding (no frame), app/dev/kit and app/api.
import type { ReactNode } from 'react';
import { ClientRouter } from './ClientRouter';

export default function AppRoutesLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <ClientRouter />
      {children}
    </>
  );
}
