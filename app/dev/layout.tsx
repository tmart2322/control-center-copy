// Gate every /dev/** page (kit galleries, lane demos) to `next dev`. FE-1a.
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

export default function DevLayout({ children }: { children: ReactNode }) {
  if (process.env.NODE_ENV !== 'development') notFound();
  return children;
}
