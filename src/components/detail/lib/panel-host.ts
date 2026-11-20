/**
 * Where details open (BUILD-V2 "Seams"): the one docked right panel once V2-SHELL has registered the
 * work-item renderer, the item sheet until then. Never a detail overlay of our own.
 */
import { getDetailRenderer } from '@/components/shell/panel';

/** True once the docked panel can render work items (V2-SHELL called registerDetailRenderer('work_item', …)). */
export function panelAvailable(): boolean {
  return !!getDetailRenderer('work_item');
}
