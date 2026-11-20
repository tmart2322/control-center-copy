'use client';
/**
 * Kit page frame: theme + density switches (design v2: dark first, light must work too; `?theme=light`
 * and `?density=compact` set them from the URL for screenshots) and the document-scroll override the long
 * gallery needs (the cockpit itself never scrolls as a page).
 */
import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { DomainClock } from '@/components/domain';
import { Portal } from '@/ui';

type Theme = 'dark' | 'light';
type Density = 'comfortable' | 'compact';

function fromUrl<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  const v = new URLSearchParams(window.location.search).get(key);
  return (allowed as readonly string[]).includes(v ?? '') ? (v as T) : fallback;
}

export function useBrandAttrs(scrollDocument: boolean) {
  const [theme, setTheme] = useState<Theme>('dark');
  const [density, setDensity] = useState<Density>('comfortable');
  useEffect(() => {
    setTheme(fromUrl('theme', ['dark', 'light'] as const, 'dark'));
    setDensity(fromUrl('density', ['comfortable', 'compact'] as const, 'comfortable'));
  }, []);
  useEffect(() => {
    const html = document.documentElement;
    const apply = () => {
      if (html.getAttribute('data-theme') !== theme) html.setAttribute('data-theme', theme);
      if (html.getAttribute('data-density') !== density) html.setAttribute('data-density', density);
      if (html.hasAttribute('data-sf-theme')) html.removeAttribute('data-sf-theme');
    };
    apply();
    // The app shell re-applies the user's saved display prefs after load; the kit's own switch wins here.
    const mo = new MutationObserver(apply);
    mo.observe(html, {
      attributes: true,
      attributeFilter: ['data-theme', 'data-density', 'data-sf-theme'],
    });
    return () => mo.disconnect();
  }, [theme, density]);
  useEffect(() => {
    if (!scrollDocument) return;
    const html = document.documentElement;
    const prev = [html.style.overflow, document.body.style.overflow, html.style.height, document.body.style.height];
    html.style.overflow = 'auto';
    document.body.style.overflow = 'visible';
    html.style.height = 'auto';
    document.body.style.height = 'auto';
    return () => {
      [html.style.overflow, document.body.style.overflow, html.style.height, document.body.style.height] = prev as [string, string, string, string];
    };
  }, [scrollDocument]);
  return { theme, setTheme, density, setDensity };
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: Array<[T, string]>; onChange: (v: T) => void; label: string }) {
  return (
    <span className="inline-flex h-8 overflow-hidden rounded-md border border-line-input" role="radiogroup" aria-label={label}>
      {options.map(([v, l], i) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          onClick={() => onChange(v)}
          className={`px-3 text-caption ${i ? 'border-l border-line-input' : ''} ${value === v ? 'bg-selected font-bold text-fg-heading' : 'bg-surface text-muted hover:bg-surface-muted'}`}
        >
          {l}
        </button>
      ))}
    </span>
  );
}

export function KitFrame({ now, tz, children, sections }: { now: string; tz: string; children: ReactNode; sections: Array<[string, string]> }) {
  const { theme, setTheme, density, setDensity } = useBrandAttrs(true);
  return (
    <DomainClock now={now} tz={tz}>
      {/* Portalled full-page overlay: the kit judges the components without the app shell around them. */}
      <Portal>
        <div className="absolute left-0 top-0 z-[70] min-h-screen w-full bg-bg" data-kit-scroll>
          <header className="relative z-40 border-b border-line bg-surface">
            <div className="flex h-14 items-center gap-3 px-6">
              <span className="grid size-7 place-items-center rounded-md bg-gradient-brand text-caption font-bold text-white">cc</span>
              <h1 className="text-title font-bold text-fg-heading">Domain kit</h1>
              <span className="text-caption text-muted">Design v2 · every domain component, every state, mock data</span>
              <span className="ml-auto flex items-center gap-2">
                <Segmented
                  label="Theme"
                  value={theme}
                  onChange={setTheme}
                  options={[
                    ['dark', 'Dark'],
                    ['light', 'Light'],
                  ]}
                />
                <Segmented
                  label="Density"
                  value={density}
                  onChange={setDensity}
                  options={[
                    ['comfortable', 'Roomy'],
                    ['compact', 'Compact'],
                  ]}
                />
                <Link
                  href={`/dev/kit/domain/today${theme === 'light' ? '?theme=light' : ''}`}
                  className="inline-flex h-8 items-center rounded-md border border-line-input px-3 text-caption font-bold text-link hover:bg-surface-muted hover:no-underline"
                >
                  Today composition →
                </Link>
              </span>
            </div>
            <nav className="flex h-10 items-center gap-1 overflow-x-auto border-t border-line px-5" aria-label="Sections">
              {sections.map(([id, label]) => (
                <a key={id} href={`#${id}`} className="whitespace-nowrap rounded-md px-2.5 py-1 text-caption text-muted hover:bg-surface-muted hover:text-fg hover:no-underline">
                  {label}
                </a>
              ))}
            </nav>
          </header>
          <main className="space-y-14 px-8 pb-32 pt-8">{children}</main>
        </div>
      </Portal>
    </DomainClock>
  );
}

export function Section({ id, title, note, children }: { id: string; title: string; note?: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-28">
      <div className="mb-4 flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-line pb-2">
        <h2 className="text-heading font-bold text-fg-heading">{title}</h2>
        {note ? <p className="max-w-[90ch] text-caption text-muted">{note}</p> : null}
      </div>
      {children}
    </section>
  );
}

export function Specimen({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <figure className={className}>
      <figcaption className="mb-2 text-caption font-bold text-muted">{label}</figcaption>
      {children}
    </figure>
  );
}
