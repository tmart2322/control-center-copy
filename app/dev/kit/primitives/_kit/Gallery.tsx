'use client';
/** /dev/kit/primitives: every primitive in every state and size, plus the interaction systems. */
import { useSearchParams } from 'next/navigation';
import { Suspense, type ReactNode } from 'react';
import { BadgesSection, ButtonsSection, ChipsSection, IconsSection } from './basics';
import { ChromeSection } from './chrome';
import { NavigationSection, OverlaysSection, SheetSection } from './overlays';
import { SaveSection } from './save';
import { FeedbackSection, PaletteSection, StatesSection } from './states';

const SECTIONS: Array<{ id: string; label: string; render: () => ReactNode }> = [
  { id: 'chrome', label: 'Chrome', render: () => <ChromeSection /> },
  { id: 'buttons', label: 'Buttons & keys', render: () => <ButtonsSection /> },
  { id: 'badges', label: 'Status marks', render: () => <BadgesSection /> },
  { id: 'chips', label: 'Chips', render: () => <ChipsSection /> },
  { id: 'icons', label: 'Icons', render: () => <IconsSection /> },
  { id: 'overlays', label: 'Overlays', render: () => <OverlaysSection /> },
  { id: 'sheet', label: 'List & side sheet', render: () => <SheetSection /> },
  { id: 'tabs', label: 'Tabs & toggles', render: () => <NavigationSection /> },
  { id: 'states', label: 'Panel states', render: () => <StatesSection /> },
  { id: 'toasts', label: 'Toasts', render: () => <FeedbackSection /> },
  { id: 'palette', label: 'Palette', render: () => <PaletteSection /> },
  { id: 'save', label: 'Save & concurrency', render: () => <SaveSection /> },
];

function Body() {
  const only = useSearchParams()?.get('section');
  const shown = only ? SECTIONS.filter((s) => s.id === only) : SECTIONS;
  return (
    <div className="flex min-h-full gap-6 px-6 py-5">
      <nav aria-label="Kit sections" className="sticky top-5 hidden w-44 shrink-0 self-start @5xl/main:block">
        <p className="eyebrow mb-2">Primitives</p>
        <ul className="space-y-0.5">
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <a href={`#${s.id}`} className="block rounded-md px-2 py-1 text-body text-muted no-underline hover:bg-surface hover:text-fg hover:no-underline">
                {s.label}
              </a>
            </li>
          ))}
        </ul>
        <p className="mt-4 px-2 text-caption text-faint">?section=id renders one section.</p>
      </nav>
      <div className="min-w-0 flex-1 space-y-5">
        <header>
          <h1 className="text-heading text-fg-heading">Primitive kit</h1>
          <p className="mt-0.5 text-body text-muted">src/ui · Salesforce look (brief 12), VDP structure (brief 07). Tokens only from brand.css.</p>
        </header>
        {shown.map((s) => (
          <div key={s.id}>{s.render()}</div>
        ))}
      </div>
    </div>
  );
}

export function Gallery() {
  return (
    <Suspense fallback={null}>
      <Body />
    </Suspense>
  );
}
