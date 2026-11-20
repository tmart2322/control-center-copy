'use client';
/** "View payload": the exact bytes, copyable (brief 08 §2.4). */
import { useState } from 'react';
import { Button, Icon } from '@/ui';
import { cx } from './_bits';
import type { PayloadView } from './preview';

export interface PayloadPanelProps {
  view: PayloadView;
  className?: string;
  /** Caption above the bytes, e.g. "What dispatch will post". */
  caption?: string;
  maxHeightClass?: string;
}

export function PayloadPanel({ view, className, caption, maxHeightClass = 'max-h-64' }: PayloadPanelProps) {
  const [tab, setTab] = useState(view.parts[0]?.id ?? 'json');
  const [copied, setCopied] = useState(false);
  const part = view.parts.find((p) => p.id === tab) ?? view.parts[0];
  if (!part) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(part.bytes);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section data-testid="payload-panel" aria-label="Payload" className={cx('overflow-hidden rounded-md border border-line bg-surface-muted', className)}>
      <header className="flex h-8 items-center gap-2 border-b border-line px-2">
        {view.parts.length > 1 ? (
          <div role="tablist" className="flex items-center gap-0.5">
            {view.parts.map((p) => (
              <button
                key={p.id}
                role="tab"
                type="button"
                aria-selected={p.id === part.id}
                onClick={() => setTab(p.id)}
                className={cx(
                  'h-6 rounded-sm px-2 text-caption focus-visible:shadow-focus focus-visible:outline-none',
                  p.id === part.id ? 'bg-surface font-bold text-fg shadow-card' : 'text-muted hover:text-fg',
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        ) : (
          <span className="px-1 text-caption font-bold text-fg">{part.label}</span>
        )}
        <span className="truncate text-caption text-muted">
          {caption ? `${caption} · ` : ''}
          {view.format} · {view.byteLength.toLocaleString()} bytes
        </span>
        <Button size="sm" variant="ghost" className="ml-auto" onClick={copy} aria-label={`Copy ${part.label}`}>
          <Icon name={copied ? 'check' : 'copy'} size="xs" />
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </header>
      <pre data-testid="payload-bytes" className={cx('overflow-auto px-3 py-2 font-mono text-caption whitespace-pre-wrap [overflow-wrap:anywhere] text-fg', maxHeightClass)}>
        {part.bytes}
      </pre>
    </section>
  );
}
