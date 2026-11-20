'use client';
/**
 * What a page or panel shows in place of a feature the persona has not activated (D-55: inactive means no daily
 * surface). Only a direct link lands here (the tab, nav item and commands are hidden): it says the feature is
 * available, not in the role's preconfiguration, and links to Settings ▸ Role & rules, where activating it brings
 * everything back.
 */
import type { PersonaFeature } from '@/contract';
import { EmptyState } from '@/ui';
import { AppLink } from './AppLink';

/** Settings ▸ Role & rules (where an available feature is activated). */
export const ROLE_SETTINGS_HREF = '/settings?section=role';

const FEATURE_NAME: Record<PersonaFeature, { name: string; plural?: boolean }> = {
  vdp: { name: 'VDP' },
  activityLogging: { name: 'Activity logging' },
  dealContributions: { name: 'Deal contributions', plural: true },
  missedOpps: { name: 'Missed opportunities', plural: true },
  specialistForecast: { name: 'The Specialist Forecast' },
  solutionsJudgement: { name: 'Solutions judgement' },
};

/** "Missed opportunities are available to activate in Settings ▸ Role & rules." */
export function featureInactiveLine(f: PersonaFeature): string {
  const { name, plural } = FEATURE_NAME[f];
  return `${name} ${plural ? 'are' : 'is'} available to activate in Settings ▸ Role & rules.`;
}

export function FeatureInactive({ feature, icon, size = 'page', className }: { feature: PersonaFeature; icon?: string; size?: 'page' | 'panel'; className?: string }) {
  return (
    <EmptyState
      size={size}
      icon={icon}
      className={className}
      title="Not in your role's preconfiguration"
      body={featureInactiveLine(feature)}
      action={
        <AppLink href={ROLE_SETTINGS_HREF} className="rounded-sm font-bold text-link hover:underline focus-visible:outline-none focus-visible:shadow-focus">
          Open Role &amp; rules
        </AppLink>
      }
    />
  );
}
