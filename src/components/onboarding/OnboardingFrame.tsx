'use client';
/** The bare, full-height frame of /onboarding (no sidebar, topbar, panel or chat): the canvas with its top glow. */
import type { ReactNode } from 'react';
import { cn } from '@/ui';
import o from './onboarding.module.css';

export function OnboardingFrame({ children }: { children: ReactNode }) {
  return (
    <div data-frame="onboarding" className={cn(o.frame, 'bg-atmosphere bg-no-repeat')}>
      {children}
    </div>
  );
}
