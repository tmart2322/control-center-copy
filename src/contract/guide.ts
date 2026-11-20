/**
 * In-app guidance: the Getting started checklist and first-visit coach marks remember what you've seen here (one
 * user, every browser). The guide lane adds the page help content and the checklist shape.
 */
import { z } from 'zod';
import { IsoDateTime, Version } from './common';

export const GuideSettings = z.object({
  version: Version,
  /** The Getting started checklist was dismissed. */
  checklistDismissed: z.boolean().default(false),
  /** Coach marks and tips already shown, by id ("home.ribbon"), with when. */
  seen: z.record(z.string(), IsoDateTime).default({}),
});
export type GuideSettings = z.infer<typeof GuideSettings>;
export const DEFAULT_GUIDE_SETTINGS: GuideSettings = GuideSettings.parse({ version: 1 });

/** Getting started (D-57 handoff): the checklist's items, computed from real state on the server. */
/** The action items (ticked from real state). Explore items are `tour.<page>` (ticked when that page's tour is done). */
export const ChecklistItemId = z.enum(['sources', 'persona', 'firstScan', 'draft', 'batch', 'assistant', 'feedback']);
export type ChecklistItemId = z.infer<typeof ChecklistItemId>;

export const ChecklistItem = z.object({
  /** An action id, or `tour.<page>` for an explore item. */
  id: z.string(),
  /** action: something to do, ticked from real state · explore: a page's tour, ticked once it is done. */
  kind: z.enum(['action', 'explore']).default('action'),
  title: z.string(),
  /** One line: what it is, or what is still missing ("Gmail needs auth"). */
  detail: z.string(),
  /** done · todo · waiting (the app is working on it: the first scan). */
  state: z.enum(['done', 'todo', 'waiting']),
  /** Where to do it (in-app path); null when the step is a panel (Assistant) or the top bar (feedback). */
  href: z.string().nullable(),
  /** The page whose guidance plays it (a route key); null: the page you are on (the Assistant, Feedback). */
  page: z.string().nullable().default(null),
  /** The button: where it goes and what happens ("Take the tour", "Open Connectors", "Show me"). */
  cta: z.string().default('Show me'),
  /** A client action besides the guidance: open the Assistant, confirm the step as is, or open Feedback. */
  action: z.enum(['assistant', 'confirm', 'feedback']).nullable().default(null),
});
export type ChecklistItem = z.infer<typeof ChecklistItem>;

/** The raw facts the checklist reads (kept in the payload so Settings ▸ About and tests can show them). */
export const GuideSignals = z.object({
  sources: z.object({ active: z.number().int(), live: z.number().int(), broken: z.array(z.string()) }),
  personaReviewed: z.boolean(),
  firstScan: z.enum(['none', 'running', 'done']),
  draftsApproved: z.number().int(),
  /** The persona's batch canvases Applied (sent, verified): the batch step ticks on these. */
  batches: z.number().int(),
  /** Staged and waiting for their Apply (the step's detail says so). */
  batchesStaged: z.number().int().default(0),
  assistantMessages: z.number().int(),
  feedbackSent: z.number().int(),
  /** Items whose "Show me" tip the user finished with Done (seen `checklist.<id>`): done whatever the state says. */
  acknowledged: z.array(ChecklistItemId).default([]),
  /** Pages whose tour is done (finished, skipped, or every step seen), for this persona. */
  toured: z.array(z.string()).default([]),
});
export type GuideSignals = z.infer<typeof GuideSignals>;

export const GuidePayload = z.object({
  items: z.array(ChecklistItem),
  done: z.number().int(),
  total: z.number().int(),
  dismissed: z.boolean(),
  signals: GuideSignals,
});
export type GuidePayload = z.infer<typeof GuidePayload>;

/** The README, for ⌘K ▸ Read the README (rendered in the app, so it works without an editor or a remote). */
export const ReadmePayload = z.object({ markdown: z.string(), path: z.string() });
export type ReadmePayload = z.infer<typeof ReadmePayload>;
