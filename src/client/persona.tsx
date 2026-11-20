'use client';
/**
 * The persona on the client (D-55): `usePersona()` resolves it from GET /settings (null while loading), and
 * `useFeature` / `<PersonaGate>` hide what is not active for it. Inactive features and sources appear only in
 * Settings ▸ Role & rules, as available to activate.
 */
import { useMemo, type ReactNode } from 'react';
import type { PersonaFeature } from '@/contract';
import { useApi } from '@/client/hooks';
import { allows, personaOf, type Gate, type ResolvedPersona } from '@/personas';

export function usePersona(): ResolvedPersona | null {
  const settings = useApi('getSettings');
  const s = settings.data;
  return useMemo(() => (s ? personaOf(s) : null), [s]);
}

export function useFeature(f: PersonaFeature): boolean {
  return allows(usePersona(), { feature: f });
}

export function PersonaGate({ gate, children, fallback = null }: { gate: Gate; children: ReactNode; fallback?: ReactNode }) {
  return allows(usePersona(), gate) ? <>{children}</> : <>{fallback}</>;
}
