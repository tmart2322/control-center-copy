/**
 * The context a feedback report carries (D-56), captured on the click that opens the panel: the page and route, what
 * the user was looking at, the build, the persona and the recent client errors. Pure (tests), plus a tiny store that
 * hands the captured context to the panel the click opens (the panel entity only has an id).
 */
import type { EntityType, FeedbackContextInput } from '@/contract';
import { pageTitleFor } from '@/components/shell/routes';

/** The docked panel's own URL parameters: not part of the page the user was on. */
const PANEL_PARAMS = new Set(['panel', 'item', 'kind']);
/** Page-level chat contexts (Settings sets one and it can outlive the page): never "Looking at" on another page. */
const PAGE_KINDS: ReadonlySet<EntityType> = new Set<EntityType>(['feedback', 'settings', 'policy']);

export interface CaptureInput {
  pathname: string;
  /** location.search ("?tab=log&panel=details&item=…"). */
  search?: string;
  /** The panel's entity, else the chat context ("Looking at"). A feedback entity is ignored. */
  lookingAt?: { kind: EntityType; id: string; label?: string } | null;
  persona?: string | null;
  version?: string;
  sha?: string | null;
  errors?: string[];
  viewport?: { width: number; height: number } | null;
}

/** "/time" + "?tab=log&panel=details&item=x" → "/time?tab=log". */
export function routeOf(pathname: string, search = ''): string {
  const q = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  for (const k of [...q.keys()]) if (PANEL_PARAMS.has(k)) q.delete(k);
  const qs = q.toString();
  return `${pathname || '/'}${qs ? `?${qs}` : ''}`.slice(0, 400);
}

export function captureFeedbackContext(i: CaptureInput): FeedbackContextInput {
  const looking = i.lookingAt && !PAGE_KINDS.has(i.lookingAt.kind) && i.lookingAt.id ? { kind: i.lookingAt.kind, id: i.lookingAt.id.slice(0, 200), label: (i.lookingAt.label ?? '').slice(0, 200) } : null;
  return {
    // The route map's title, never a page's own override (that can be an account's name).
    page: pageTitleFor(i.pathname).slice(0, 120),
    route: routeOf(i.pathname, i.search),
    lookingAt: looking,
    version: (i.version ?? '').slice(0, 40),
    sha: i.sha ? i.sha.slice(0, 64) : null,
    persona: i.persona ? i.persona.slice(0, 40) : null,
    clientErrors: (i.errors ?? []).slice(-10).map((e) => e.slice(0, 400)),
    viewport: i.viewport ? `${Math.round(i.viewport.width)}×${Math.round(i.viewport.height)}` : null,
  };
}

// ── The click → panel hand-off ──────────────────────────────────────────────────────────────

const opened = new Map<string, FeedbackContextInput>();
let seq = 0;

/** Remember the context for a new report; returns the panel entity id. */
export function openFeedbackReport(ctx: FeedbackContextInput): string {
  const id = `report-${Date.now().toString(36)}-${++seq}`;
  opened.set(id, ctx);
  if (opened.size > 5) opened.delete(opened.keys().next().value!);
  return id;
}

/** The context captured for this report (null after a reload: the panel captures what it can then). */
export function feedbackContextFor(id: string): FeedbackContextInput | null {
  return opened.get(id) ?? null;
}

/** The browser build: lane E's NEXT_PUBLIC_CC_VERSION when set, and the sha baked into the bundle. */
export const CLIENT_BUILD = {
  version: process.env.NEXT_PUBLIC_CC_VERSION ?? '',
  sha: process.env.NEXT_PUBLIC_CC_GIT_SHA ?? null,
};
