'use client';
/**
 * LD-1: "Looks done: confirm". Work the engine thinks is finished waits here for one click, never in Do now or
 * the verb columns: the green "Looks done" badge (color says ready, the ✓ glyph says it too), the evidence line,
 * Confirm (it closes, Undo on the toast) or Not done (it goes back to its live state). One line: the newest item with
 * its whole evidence line (two side by side at a wide container), the rest in Triage's Looks done group, so the page
 * still fits 1920×1000 (HOME-2: two at 1920 cut the evidence to a dozen characters).
 */
import { AppLink } from '@/components/shell/AppLink';
import type { HomeLooksDone } from '@/contract';
import { useHomeView } from './ctx';

export function LooksDone({ g }: { g: HomeLooksDone }) {
  const v = useHomeView();
  if (!g.count) return null;
  const more = Math.max(0, g.count - g.rows.length);
  return (
    <section className="hm-panel hm-ld" data-tone="ready" data-home-panel="looks-done" aria-label="Looks done: confirm">
      <span className="hm-badge" data-tone="ready">
        <span aria-hidden>✓</span>Looks done: confirm{g.count > 1 ? ` ${g.count}` : ''}
      </span>
      <ul className="hm-ld-rows">
        {g.rows.map((r) => {
          const err = v.actions.errors[r.id];
          return (
            <li key={r.id} className="hm-ld-row" data-item-id={r.id} data-testid="looks-done-row">
              <AppLink className="hm-ld-name hm-trunc" href={r.href} title={r.title}>
                {r.title}
              </AppLink>
              <span className={`hm-ld-ev hm-trunc${err ? ' is-err' : ''}`} title={r.evidence}>
                {err ? `Couldn't ${err.verb}: ${err.message}` : r.evidence}
              </span>
              <span className="hm-ld-acts">
                <button type="button" className="hm-btn is-secondary is-sm hm-ld-confirm" data-testid="looks-done-confirm" title="Close it as done (Undo on the toast)" onClick={() => v.actions.confirmDone(r.item, r.title)}>
                  <span aria-hidden>✓</span> Confirm
                </button>
                <button type="button" className="hm-btn is-quiet" data-testid="looks-done-not" title="Not finished: back among the open work" onClick={() => v.actions.notDone(r.item, r.title)}>
                  Not done
                </button>
              </span>
            </li>
          );
        })}
      </ul>
      {more ? (
        <AppLink className="hm-link hm-ld-more" href="/triage">
          +{more} in Triage →
        </AppLink>
      ) : null}
    </section>
  );
}
