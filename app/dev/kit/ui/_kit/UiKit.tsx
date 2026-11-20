'use client';
/**
 * /dev/kit/ui: every @/ui primitive, v2. Two `data-theme` islands (dark | light) side by side, so one screenshot shows
 * both themes; the layers section follows the page theme. Params: ?theme=dark|light|system, ?layout=single,
 * ?density=compact, ?text=sm|lg, ?open=1|dialog|sheet.
 */
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { SegmentedToggle } from '@/ui';
import { IslandContext } from './frame';
import { OverlaysSection } from './overlays';
import { ButtonsSection, ChipsSection, ListsSection, StatesSection, StatusSection, TabsSection, TokensSection } from './sections';

type Theme = 'dark' | 'light' | 'system';
type Layout = 'split' | 'single';
type Density = 'roomy' | 'compact';
type TextSize = 'sm' | 'md' | 'lg';

const SECTIONS = [
  { id: 'tokens', label: 'Tokens', render: () => <TokensSection /> },
  { id: 'buttons', label: 'Buttons', render: () => <ButtonsSection /> },
  { id: 'status', label: 'Status', render: () => <StatusSection /> },
  { id: 'chips', label: 'References', render: () => <ChipsSection /> },
  { id: 'lists', label: 'Lists', render: () => <ListsSection /> },
  { id: 'tabs', label: 'Tabs', render: () => <TabsSection /> },
  { id: 'states', label: 'States', render: () => <StatesSection /> },
];

function pick<T extends string>(v: string | null, allowed: readonly T[], fallback: T): T {
  return v && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

/** A themed island: sets color-scheme for its subtree and repaints bg + text in that scheme. */
function Island({ theme }: { theme: 'dark' | 'light' }) {
  return (
    <IslandContext.Provider value={theme}>
      <div data-theme={theme} data-kit-island={theme} className="min-w-0 rounded-xl border border-line bg-bg bg-atmosphere p-4 text-fg">
        <p className="mb-3 px-1 text-caption font-bold text-muted">{theme === 'dark' ? 'Dark (default)' : 'Light'}</p>
        <div className="flex flex-col gap-4">
          {SECTIONS.map((s) => (
            <div key={s.id}>{s.render()}</div>
          ))}
        </div>
      </div>
    </IslandContext.Provider>
  );
}

export function UiKit() {
  const params = useSearchParams();
  const [theme, setTheme] = useState<Theme>(() => pick(params?.get('theme') ?? null, ['dark', 'light', 'system'] as const, 'dark'));
  const [layout, setLayout] = useState<Layout>(() => pick(params?.get('layout') ?? null, ['split', 'single'] as const, 'split'));
  const [density, setDensity] = useState<Density>(() => (params?.get('density') === 'compact' ? 'compact' : 'roomy'));
  const [text, setText] = useState<TextSize>(() => pick(params?.get('text') ?? null, ['sm', 'md', 'lg'] as const, 'md'));
  const open = params?.get('open') ?? null;

  // Page theme on <body> (portaled layers live there). The shell's prefs own <html data-theme>; body wins below it.
  useEffect(() => {
    document.body.setAttribute('data-theme', theme);
    return () => document.body.removeAttribute('data-theme');
  }, [theme]);
  useEffect(() => {
    const h = document.documentElement;
    const prev = h.getAttribute('data-density');
    h.setAttribute('data-density', density === 'compact' ? 'compact' : 'comfortable');
    return () => {
      if (prev) h.setAttribute('data-density', prev);
    };
  }, [density]);
  useEffect(() => {
    const h = document.documentElement;
    if (text === 'md') h.removeAttribute('data-text');
    else h.setAttribute('data-text', text);
    return () => h.removeAttribute('data-text');
  }, [text]);

  const single: 'dark' | 'light' = theme === 'light' ? 'light' : 'dark';
  return (
    <div className="flex flex-col gap-6 px-6 py-6 text-fg">
      <header className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h1 className="text-heading">UI kit · v2</h1>
          <p className="mt-1 max-w-measure text-body text-muted">
            src/ui on the v2 tokens (DESIGN-V2, brief 14). Dark first, colour as an indicator only, quiet actions and loud selection. Placeholder data only.
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-3">
          <SegmentedToggle
            label="Page theme"
            value={theme}
            onChange={setTheme}
            options={[
              { value: 'dark', label: 'Dark' },
              { value: 'light', label: 'Light' },
              { value: 'system', label: 'System' },
            ]}
          />
          <SegmentedToggle
            label="Layout"
            value={layout}
            onChange={setLayout}
            options={[
              { value: 'split', label: 'Side by side' },
              { value: 'single', label: 'Page theme only' },
            ]}
          />
          <SegmentedToggle
            label="Density"
            value={density}
            onChange={setDensity}
            options={[
              { value: 'roomy', label: 'Roomy' },
              { value: 'compact', label: 'Compact' },
            ]}
          />
          <SegmentedToggle
            label="Text size"
            value={text}
            onChange={setText}
            options={[
              { value: 'sm', label: '15' },
              { value: 'md', label: '16' },
              { value: 'lg', label: '18' },
            ]}
          />
        </div>
      </header>
      <nav aria-label="Kit sections" className="flex flex-wrap gap-1">
        {[...SECTIONS, { id: 'overlays', label: 'Layers' }].map((s) => (
          <a key={s.id} href={`#${s.id}`} className="rounded-md px-2.5 py-1 text-caption font-bold text-muted no-underline hover:bg-fg/8 hover:text-fg hover:no-underline">
            {s.label}
          </a>
        ))}
      </nav>
      {layout === 'split' ? (
        <div className="grid grid-cols-2 items-start gap-4">
          <Island theme="dark" />
          <Island theme="light" />
        </div>
      ) : (
        <Island theme={single} />
      )}
      <OverlaysSection open={open} />
    </div>
  );
}
