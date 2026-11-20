/**
 * Registers the docked panel's Details renderer for `feedback` (D-56): the "Report a bug / idea" panel. Browser
 * only, like src/components/panels/register.ts (on the server the client registry is only a reference).
 */
import { createElement } from 'react';
import { registerDetailRenderer } from '@/components/shell/panel';
import { FeedbackPanel } from './FeedbackPanel';

if (typeof window !== 'undefined') {
  registerDetailRenderer('feedback', (e) => createElement(FeedbackPanel, { key: e.id, reportId: e.id }));
}

export const FEEDBACK_RENDERER_REGISTERED = true;
