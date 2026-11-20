'use client';
/**
 * Keyboard hints. `Kbd` is one key cap; `KbdHint` renders a key spec ("mod+k", "g h", "shift+enter")
 * as caps, mac glyphs on macOS. Mono is reserved for exactly this (brief 12 §6).
 * v2 (mockup `.kbd`): 12 px mono on surface-sunken with a hairline. `inverse` tints from the text colour, so it
 * reads on any fill (accent buttons, tooltips) in both themes.
 */
import type { ReactNode } from 'react';
import { sequenceKeys, formatShortcut } from '@/client/keyboard/keymap';
import { useIsMac } from '@/client/keyboard/KeyboardProvider';
import { cn } from './cn';

export type KbdTone = 'default' | 'inverse' | 'quiet';

const TONE: Record<KbdTone, string> = {
  default: 'border border-line bg-surface-sunken text-muted',
  quiet: 'border border-current/25 text-muted',
  inverse: 'border border-current/30 bg-current/15',
};

export function Kbd({ children, tone = 'default', className }: { children: ReactNode; tone?: KbdTone; className?: string }) {
  return (
    <kbd
      className={cn(
        'inline-grid h-5 min-w-5 place-items-center rounded-sm px-1.5 font-mono text-micro leading-none font-normal',
        TONE[tone],
        className,
      )}
    >
      {children}
    </kbd>
  );
}

export interface KbdHintProps {
  /** Key spec: "mod+k", "g h", "shift+enter", "j|k" ("|" = alternatives). */
  combo: string;
  tone?: KbdTone;
  className?: string;
}

/** A small key hint used in buttons, menus, the palette and the cheat sheet. */
export function KbdHint({ combo, tone = 'default', className }: KbdHintProps) {
  const isMac = useIsMac();
  const alternatives = combo.split('|');
  return (
    <span className={cn('inline-flex items-center gap-1 whitespace-nowrap', className)} aria-label={alternatives.map((a) => formatShortcut(a, isMac)).join(' or ')}>
      {alternatives.map((alt, ai) => (
        <span key={ai} className="inline-flex items-center gap-1" aria-hidden>
          {ai > 0 ? <span className="text-micro text-muted">/</span> : null}
          {sequenceKeys(alt, isMac).map((group, gi) => (
            <span key={gi} className="inline-flex items-center gap-0.5">
              {gi > 0 ? <span className="px-0.5 text-micro text-muted">then</span> : null}
              {isMac ? (
                <Kbd tone={tone}>{group.join('')}</Kbd>
              ) : (
                group.map((k, ki) => (
                  <Kbd key={ki} tone={tone}>
                    {k}
                  </Kbd>
                ))
              )}
            </span>
          ))}
        </span>
      ))}
    </span>
  );
}
