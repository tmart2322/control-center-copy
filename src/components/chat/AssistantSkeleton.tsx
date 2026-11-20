'use client';
/**
 * The Assistant page's loading skeleton, data-free: threads | conversation (head · messages · composer) | In this
 * thread, in the page's grid (the context pane appears at ≥ 1,300 px of page, as on the page), so nothing jumps
 * when /assistant lands. The route's loading.tsx and the shell's pending-navigation skeleton render it.
 */
import { Button, Skeleton } from '@/ui';
import { ChatIcon } from './icons';
import s from './assistant.module.css';

const noop = () => {};

export function AssistantSkeleton() {
  return (
    <div className={s.pageWrap}>
      <div className={`${s.root} ${s.page}`}>
        <nav className={s.th} aria-label="Threads">
          <div className={s.thHead}>
            <h2>Threads</h2>
            <Button variant="secondary" size="sm" onClick={noop}>
              <ChatIcon name="plus" size={14} /> New thread
            </Button>
          </div>
          <span className={s.thSearch}>
            <ChatIcon name="search" size={14} />
            <span className="text-caption">Search threads</span>
          </span>
          <div className={s.thList} aria-hidden>
            <Skeleton variant="line" count={6} className="px-2 pt-2 [&>span]:h-4" />
          </div>
        </nav>

        <section className={`${s.pane} ${s.cv}`} aria-label="Conversation">
          <header className={s.cvHead}>
            <div>
              <h2>Assistant</h2>
              <div className={s.meta}>{' '}</div>
            </div>
          </header>
          <div className="min-h-0 flex-1 overflow-hidden px-6 py-6" aria-hidden>
            <div className="mx-auto flex max-w-[760px] flex-col gap-6">
              <Skeleton variant="line" count={2} className="ml-auto w-1/2" />
              <Skeleton variant="line" count={4} />
              <Skeleton variant="line" count={2} className="ml-auto w-2/5" />
              <Skeleton variant="line" count={3} />
            </div>
          </div>
          <div className={s.composer} aria-hidden>
            <div className={s.composerIn}>
              {/* The composer box, its suggestion chips and the key-hint line. */}
              <div className="h-[106px] rounded-lg border border-line-strong bg-surface-input" />
              <div className="mt-3 flex gap-2">
                <span className="h-8 w-36 animate-pulse rounded-md bg-surface-sunken" />
                <span className="h-8 w-72 animate-pulse rounded-md bg-surface-sunken" />
                <span className="h-8 w-40 animate-pulse rounded-md bg-surface-sunken" />
              </div>
              <div className="mt-2 h-5" />
            </div>
          </div>
        </section>

        <aside className={`${s.pane} ${s.cx}`} aria-label="In this thread">
          <div className="flex flex-col gap-4 px-6 pt-5" aria-hidden>
            <Skeleton variant="line" className="w-32" />
            <Skeleton variant="line" count={4} />
          </div>
        </aside>
      </div>
    </div>
  );
}
