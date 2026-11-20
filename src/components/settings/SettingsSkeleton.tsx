'use client';
/**
 * Settings' loading skeleton, data-free: the page header with "Find a setting", the grouped section nav (labels
 * only; the per-section summaries need data), the selected section's header and the effect pane in the final
 * three-pane grid, so nothing jumps when /settings lands. The route's loading.tsx and the shell's
 * pending-navigation skeleton render it before the route arrives.
 */
import { KbdHint, Skeleton } from '@/ui';
import { Glyph } from './controls';
import { DEFAULT_SECTION, SECTION_GROUPS, SECTIONS } from './derive';
import s from './settings.module.css';

export function SettingsSkeleton() {
  const active = DEFAULT_SECTION;
  const title = SECTIONS.find((x) => x.id === active)?.label ?? 'Settings';
  return (
    <div className={s.root} data-section={active}>
      <header className={s.topbar}>
        <h1>Settings</h1>
        <span className={s.find}>
          <Glyph name="search" className={s.findGlyph} />
          <span className="min-w-0 flex-1 truncate text-body text-faint">Find a setting…</span>
          <KbdHint combo="mod+k" />
        </span>
      </header>
      <div className={s.grid}>
        <nav className={s.nav} aria-label="Settings sections">
          {SECTION_GROUPS.map((g) => (
            <div className={s.group} key={g.label}>
              <div className={s.groupLabel}>{g.label}</div>
              {g.items.map((it) => (
                <span key={it.id} className={s.item} aria-current={it.id === active ? 'page' : undefined}>
                  <span className={s.itemTitle}>{it.label}</span>
                  <span />
                  <span className={s.itemSum}>{' '}</span>
                </span>
              ))}
            </div>
          ))}
          <div className={s.navFoot}>
            <span>Each section says how it saves.</span>
            <span>Edits wait here while you look elsewhere.</span>
          </div>
        </nav>
        <div className={s.spane}>
          <section className={s.sec}>
            <header className={s.secHead}>
              <h2 className={s.secTitle}>{title}</h2>
            </header>
            <div className="flex flex-col gap-6 pt-6" aria-hidden>
              <Skeleton variant="line" count={3} className="max-w-[40rem]" />
              <Skeleton variant="block" className="h-40 w-full" />
              <Skeleton variant="block" className="h-40 w-full" />
            </div>
          </section>
        </div>
        <aside className={s.epane} aria-label="Effect preview">
          <div className="flex flex-col gap-4 p-6" aria-hidden>
            <Skeleton variant="line" className="w-40" />
            <Skeleton variant="block" className="h-48 w-full" />
          </div>
        </aside>
      </div>
    </div>
  );
}
