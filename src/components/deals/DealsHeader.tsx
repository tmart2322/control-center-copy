'use client';
/**
 * Deals noun tabs (design v2: tabs stay nouns, line variant). Tabs are routes: /deals, /deals/missed and /deals/dcs.
 * The Missed tab shows only while the persona has the missed-opp sweep, the DCs tab (my DCs and DC requests) only
 * while it has deal contributions (D-55); while the persona loads they stay hidden.
 */
import { Tabs } from '@/ui';
import { navigate } from '@/components/shell/router';
import { useDealsFeatures } from './hooks';

export type DealsTab = 'deals' | 'missed' | 'dcs';

const TAB_PATH: Record<DealsTab, string> = { deals: '/deals', missed: '/deals/missed', dcs: '/deals/dcs' };

export function DealsTabs({ tab, missedCount }: { tab: DealsTab; missedCount?: number }) {
  const { missed, dc } = useDealsFeatures();
  return (
    <Tabs<DealsTab>
      label="Deals sections"
      idBase="deals"
      variant="line"
      value={tab}
      onChange={(v) => navigate(TAB_PATH[v])}
      tabs={[{ value: 'deals', label: 'Accounts' }, ...(missed ? [{ value: 'missed' as const, label: 'Missed opportunities', count: missedCount }] : []), ...(dc ? [{ value: 'dcs' as const, label: 'DCs' }] : [])]}
    />
  );
}
