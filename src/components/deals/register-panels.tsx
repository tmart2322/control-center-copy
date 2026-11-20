'use client';
/**
 * Registers the context pages' Details renderers with the docked panel, in the browser only (registering during
 * server rendering broke the frame once) and once per session: a panel opened on one page keeps rendering after
 * navigation, so these are never unregistered.
 *   account · opportunity (Deals) · brief_highlight (Briefs) · activity_entry, vdp (Time)
 *   missed_opp is shared with Triage (P-LISTS, src/components/lists/triage-panels.tsx), which opens it with a
 *   Triage item id while Deals ▸ Missed opens it with a sweep id. One renderer serves both: a sweep id gets the
 *   Deals panel, anything else Triage's own panel, so neither page's Details breaks whichever page loaded first.
 * Personas (D-55): without the missed-opp sweep every missed_opp id is Triage's (the sweep is not read); without VDP
 * a vdp panel (an old link, a chat card) says VDP is available to activate instead of reading it.
 */
import { useEffect } from 'react';
import { useFeature, usePersona } from '@/client/persona';
import { FeatureInactive } from '@/components/shell/FeatureInactive';
import type { PanelEntity } from '@/components/shell/panel';
import { registerDetailRenderer } from '@/components/shell/panel';
import { HighlightPanel } from '@/components/briefs/HighlightPanel';
import { MissedOppPanel as TriageMissedPanel } from '@/components/lists/triage-panels';
import { ActivityPanel } from '@/components/time/ActivityPanel';
import { VdpPanel } from '@/components/time/VdpPanel';
import { Skeleton } from '@/ui';
import { useDealsFeatures, useMissedSweep } from './hooks';
import { AccountPanel, MissedPanel, OpportunityPanel } from './panels';

let registered = false;

function PanelLoading() {
  return (
    <div className="px-6 py-5">
      <Skeleton variant="row" count={4} />
    </div>
  );
}

function MissedOrTriage({ id }: { id: string }) {
  const f = useDealsFeatures();
  const sweep = useMissedSweep(f);
  if (!f.ready || (f.missed && sweep.isLoading)) return <PanelLoading />;
  return f.missed && sweep.data?.missed.some((m) => m.id === id) ? <MissedPanel id={id} /> : <TriageMissedPanel id={id} />;
}

function VdpOrInactive({ id, label }: { id: string; label?: string }) {
  const persona = usePersona();
  const vdp = useFeature('vdp');
  if (!persona) return <PanelLoading />;
  return vdp ? <VdpPanel id={id} label={label} /> : <FeatureInactive feature="vdp" icon="opportunity" size="panel" />;
}

export function registerContextPanels() {
  if (registered || typeof window === 'undefined') return;
  registered = true;
  registerDetailRenderer('account', (e: PanelEntity) => <AccountPanel key={e.id} id={e.id} />);
  registerDetailRenderer('opportunity', (e: PanelEntity) => <OpportunityPanel key={e.id} id={e.id} label={e.label} />);
  registerDetailRenderer('missed_opp', (e: PanelEntity) => <MissedOrTriage key={e.id} id={e.id} />);
  registerDetailRenderer('brief_highlight', (e: PanelEntity) => <HighlightPanel key={e.id} id={e.id} label={e.label} />);
  registerDetailRenderer('activity_entry', (e: PanelEntity) => <ActivityPanel key={e.id} id={e.id} label={e.label} />);
  registerDetailRenderer('vdp', (e: PanelEntity) => <VdpOrInactive key={e.id} id={e.id} label={e.label} />);
}

export function useContextPanels() {
  useEffect(() => registerContextPanels(), []);
}
