/**
 * Today's first-paint skeleton, data-free: the day header (date · verdict · capacity) and the three panes
 * (Day · Run of day · Agent's plan, or the plan's side tab below 1,600 px of main) with the real classes, so the
 * panes sit where they will and nothing jumps when /today lands. TodayPage renders it until its data and layout
 * exist; the route's loading.tsx and the shell's pending-navigation skeleton render it before the route arrives.
 * `error` replaces the panes (TodayPage passes its PanelError).
 */
import type { ReactNode } from 'react';
import './today.css';

const BAR = 'inline-block animate-pulse rounded-md bg-surface-sunken align-top';
/** A non-breaking space gives a bar its line box (the real text's height). */
const NBSP = ' ';

function Rows({ n }: { n: number }) {
  return (
    <div className="flex flex-col gap-3 px-5 pt-2" aria-hidden>
      {Array.from({ length: n }, (_, i) => (
        <span key={i} className="block h-12 animate-pulse rounded-md bg-surface-sunken" style={{ opacity: 1 - i * 0.12 }} />
      ))}
    </div>
  );
}

function PaneHead({ title }: { title: ReactNode }) {
  return (
    <div className="td-pane-head">
      <h2>{title}</h2>
      <span className="td-count">
        <span className={`${BAR} w-24`}>{NBSP}</span>
      </span>
    </div>
  );
}

export function TodaySkeleton({ error }: { error?: ReactNode }) {
  return (
    <div data-today-root className="td-root" aria-busy>
      <section className="td-head" aria-hidden>
        <h2 className="td-date">
          <span className={`${BAR} w-56`}>{NBSP}</span>
        </h2>
        <div className="grid min-w-0 flex-1 gap-1">
          {/* The usual verdict: two lines plus the background-runs line. */}
          <p className="td-verdict">
            <span className={`${BAR} w-full max-w-[36rem]`}>{NBSP}</span>
            <br />
            <span className={`${BAR} w-2/3 max-w-[24rem]`}>{NBSP}</span>
          </p>
          <p className="td-bgrun text-caption">
            <span className={`${BAR} w-80`}>{NBSP}</span>
          </p>
        </div>
        <div className="td-cap">
          <div className="flex items-center gap-2.5">
            <span className={`${BAR} h-6 w-16`} />
            <span className="ml-auto text-body-lg font-bold">
              <span className={`${BAR} w-20`}>{NBSP}</span>
            </span>
          </div>
          <div className="td-capbar" />
          <div className="flex justify-between text-caption text-muted">
            <span className={`${BAR} w-24`}>{NBSP}</span>
            <span className={`${BAR} w-16`}>{NBSP}</span>
          </div>
        </div>
      </section>
      {error ? (
        <div className="td-pane">{error}</div>
      ) : (
        <div className="td-panes">
          <div className="td-pane">
            <PaneHead title="Day" />
            <Rows n={8} />
          </div>
          <div className="td-pane">
            <PaneHead title="Run of day" />
            <Rows n={6} />
          </div>
          <div className="td-plan-tab" aria-hidden>
            <span className="text-ai-700">✦</span>
            <span className="td-vt">{"Agent's plan"}</span>
          </div>
          <div className="td-pane td-plan">
            <PaneHead
              title={
                <>
                  <span className="text-ai-700">✦</span> Agent’s plan
                </>
              }
            />
            <Rows n={4} />
          </div>
        </div>
      )}
    </div>
  );
}
