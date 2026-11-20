'use client';
/**
 * Detail renderers the frame registers for the docked panel (BUILD-V2 "Seams"). Registered at import,
 * before the first render, so a reload on `?panel=details&item=…` renders straight away.
 *
 *   work_item → renderItemPanel(id) = <ItemDetail itemId variant="panel"/> (V2-DETAIL)
 *   draft     → registered by V2-DETAIL itself (detail/lib/register.ts)
 *   the rest  → the panel's generic fallback (label, kind, "Open page →")
 *
 * Browser only, like V2-DETAIL's own registration: server components import these barrels too, and on the
 * server the client registry is only a reference that can't be called.
 */
import { renderItemPanel } from '@/components/detail';
import '@/components/panels/register'; // P-CONTEXT-B registers calendar_event, connector, agent_run, tool_adapter, tool_run itself
import '@/components/feedback/register'; // D-56: the Report a bug / idea panel
import { registerDetailRenderer } from './panel';
import { ForecastPanel } from '@/components/time/ForecastPanel';

if (typeof window !== 'undefined') {
  registerDetailRenderer('work_item', (e) => renderItemPanel(e.id));
  registerDetailRenderer('specialist_forecast', (e) => <ForecastPanel key={e.id} id={e.id} />); // lane A: Time ▸ Forecast details
}

export const DETAIL_RENDERERS_REGISTERED = true;
