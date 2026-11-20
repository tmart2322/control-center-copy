'use client';
/** Settings form controls (tokens only): select, checkbox, switch, number, range with a "was" tick, day picker, glyphs. */
import { forwardRef, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import { cn } from '@/ui';
import { DAY_NAMES } from './derive';
import s from './settings.module.css';

export const inputCls = (...extra: Array<string | false | undefined>) => cn(s.in, ...extra);

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { width?: 'xs' | 'sm' | 'md' | 'full' }>(function TextInput({ width = 'md', className, ...rest }, ref) {
  return <input ref={ref} className={cn(s.in, width === 'xs' ? s.wXs : width === 'sm' ? s.wSm : width === 'full' ? s.wFull : s.wMd, className)} {...rest} />;
});

export function NumberInput({ value, onValue, min, max, step = 1, width, className, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & { value: number; onValue: (n: number) => void; min?: number; max?: number; step?: number; width?: number }) {
  return (
    <input
      type="number"
      inputMode="decimal"
      className={cn(s.in, s.num, className)}
      style={width ? { width } : undefined}
      value={Number.isFinite(value) ? value : ''}
      min={min}
      max={max}
      step={step}
      onChange={(e) => onValue(e.target.value === '' ? NaN : Number(e.target.value))}
      {...rest}
    />
  );
}

export function Select({ className, wrapClassName, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { wrapClassName?: string }) {
  return (
    <span className={cn(s.sel, wrapClassName)}>
      <select className={cn(s.in, className)} {...rest}>
        {children}
      </select>
    </span>
  );
}

export function Check({ checked, onChange, children, disabled, testId, label }: { checked: boolean; onChange: (v: boolean) => void; children?: ReactNode; disabled?: boolean; testId?: string; label?: string }) {
  const box = <input type="checkbox" className={s.cb} checked={checked} disabled={disabled} aria-label={children ? undefined : label} onChange={(e) => onChange(e.target.checked)} data-testid={testId} />;
  if (!children) return box;
  return (
    <label className={s.check}>
      {box}
      {children}
    </label>
  );
}

export function Switch({ checked, onChange, id, label, testId }: { checked: boolean; onChange: (v: boolean) => void; id?: string; label: string; testId?: string }) {
  return <input id={id} type="checkbox" role="switch" aria-label={label} aria-checked={checked} className={s.switch} checked={checked} onChange={(e) => onChange(e.target.checked)} data-testid={testId} />;
}

/** A 0–max slider: neutral when idle, blue when it holds your change, with a grey tick at the applied value. */
export function RangeField({ id, value, was, min = 0, max = 10, step = 0.5, onValue, label, numberWidth }: { id: string; value: number; was?: number; min?: number; max?: number; step?: number; onValue: (n: number) => void; label: string; numberWidth?: number }) {
  const pct = ((value - min) / (max - min)) * 100;
  const changed = was !== undefined && was !== value;
  return (
    <div className={s.range}>
      <span className={s.trackWrap}>
        <input id={id} type="range" className={s.slider} min={min} max={max} step={step} value={value} style={{ ['--p' as string]: `${pct}%` }} onChange={(e) => onValue(Number(e.target.value))} />
        {changed ? <span className={s.wasTick} style={{ left: `calc(10px + (100% - 20px) * ${(was! - min) / (max - min)})` }} aria-hidden /> : null}
      </span>
      <NumberInput value={value} min={min} max={max} step={step} onValue={(n) => Number.isFinite(n) && onValue(n)} aria-label={`${label} value`} width={numberWidth} />
    </div>
  );
}

export function DaysPicker({ days, onChange }: { days: number[]; onChange: (d: number[]) => void }) {
  return (
    <div className={s.days} role="group" aria-label="Working days">
      {DAY_NAMES.map((n, i) => {
        const on = days.includes(i);
        return (
          <button key={n} type="button" aria-pressed={on} onClick={() => onChange(on ? days.filter((x) => x !== i) : [...days, i].sort((a, b) => a - b))}>
            {n}
          </button>
        );
      })}
    </div>
  );
}

export function MiniButton({ label, onClick, children, className }: { label: string; onClick: () => void; children: ReactNode; className?: string }) {
  return (
    <button type="button" className={cn(s.miniBtn, className)} aria-label={label} title={label} onClick={onClick}>
      {children}
    </button>
  );
}

// ── glyphs (16 × 16, currentColor) ─────────────────────────────────────────────────────────

const PATHS = {
  lock: 'M5 7V5a3 3 0 0 1 6 0v2h1v7H4V7zm1.6 0h2.8V5a1.4 1.4 0 0 0-2.8 0z',
  warn: 'M8 1 15 14H1zm-.8 5v4h1.6V6zm0 5v1.6h1.6V11z',
  reset: 'M8 2a6 6 0 1 1-5.7 7.9l1.5-.5A4.4 4.4 0 1 0 4.6 4.6L6 6H2V2l1.5 1.5A6 6 0 0 1 8 2',
  close: 'M3.5 2.4 8 6.9l4.5-4.5 1.1 1.1L9.1 8l4.5 4.5-1.1 1.1L8 9.1l-4.5 4.5-1.1-1.1L6.9 8 2.4 3.5z',
  bldg: 'M2 14V2h8v4h4v8zm2-10v2h2V4zm0 4v2h2V8zm6 0v2h2V8zm-6 3v2h2v-2z',
  person: 'M8 2a3 3 0 1 1 0 6 3 3 0 0 1 0-6M2 14c0-3 3-5 6-5s6 2 6 5z',
  kind: 'M2 2h6l6 6-6 6-6-6zm3 2a1.3 1.3 0 1 0 0 2.6A1.3 1.3 0 0 0 5 4',
  doc: 'M3 1h7l3 3v11H3zm2 6v1.5h6V7zm0 3v1.5h6V10z',
  clock: 'M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1m.8 3v4.4l3 1.8-.8 1.3-3.8-2.3V4z',
  lines: 'M2 3h12v2H2zm0 4h12v2H2zm0 4h8v2H2z',
  cal: 'M3 2h2v1h6V2h2v1h1v11H2V3h1zm0 4v7h10V6z',
  search: 'M7 2a5 5 0 0 1 4 8l3 3-1 1-3-3a5 5 0 1 1-3-9m0 1.6a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8',
  check: 'M6.2 11.6 2.6 8l1.1-1.1 2.5 2.5 6.1-6.1L13.4 4.4z',
} as const;

export type GlyphName = keyof typeof PATHS;

export function Glyph({ name, className, label }: { name: GlyphName; className?: string; label?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" className={className} width={16} height={16} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <path d={PATHS[name]} />
    </svg>
  );
}
