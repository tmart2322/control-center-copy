// Dev-only v2 primitive kit (V2-TOKENS). 404 outside `next dev`.
// Every @/ui primitive in dark and light side by side. Params: ?theme=dark|light|system (page + overlays),
// ?layout=single (one theme only), ?density=compact, ?text=sm|lg, ?open=1 (menu + tooltip open), ?open=dialog.
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { UiKit } from './_kit/UiKit';

export const metadata = { title: 'UI kit v2 · Command Center' };

export default function Page() {
  if (process.env.NODE_ENV !== 'development') notFound();
  return (
    <Suspense fallback={null}>
      <UiKit />
    </Suspense>
  );
}
