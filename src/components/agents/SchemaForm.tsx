'use client';
/** Renders a form from FieldSpec[] (see schema-form.ts). Controlled; errors come from `validate`. */
import { useId } from 'react';
import { cn } from '@/ui';
import type { FieldSpec, FormValues } from './schema-form';

const CONTROL = 'w-full rounded-md border border-line-input bg-surface px-2 text-body text-fg placeholder:text-faint focus:border-brand-600 focus:outline-none aria-[invalid=true]:border-danger-600';

export function SchemaForm({ fields, values, errors, onChange, disabled }: { fields: FieldSpec[]; values: FormValues; errors: Record<string, string>; onChange: (key: string, value: string | boolean) => void; disabled?: boolean }) {
  const base = useId();
  return (
    <div className="flex flex-col gap-3">
      {fields.map((f) => {
        const id = `${base}-${f.key}`;
        const err = errors[f.key];
        const help = err ?? f.help;
        const label = (
          <label htmlFor={id} className="text-caption font-bold text-fg">
            {f.label}
            {f.required ? (
              <span className="text-danger-700" aria-hidden>
                {' '}
                *
              </span>
            ) : null}
            {f.required ? <span className="sr-only"> (required)</span> : null}
          </label>
        );
        const v = values[f.key];
        return (
          <div key={f.key} className="flex flex-col gap-1">
            {f.kind === 'boolean' ? (
              <label className="flex items-start gap-2 text-body text-fg">
                <input id={id} type="checkbox" checked={v === true} disabled={disabled} onChange={(e) => onChange(f.key, e.target.checked)} className="mt-0.5 size-4 accent-brand-600" />
                <span>
                  <span className="font-bold">{f.label}</span>
                  {f.help ? <span className="block text-caption font-normal text-muted">{f.help}</span> : null}
                </span>
              </label>
            ) : (
              <>
                {label}
                {f.kind === 'textarea' ? (
                  <textarea id={id} rows={4} value={String(v ?? '')} disabled={disabled} aria-invalid={!!err} aria-describedby={help ? `${id}-help` : undefined} onChange={(e) => onChange(f.key, e.target.value)} className={cn(CONTROL, 'py-1.5')} />
                ) : f.kind === 'select' ? (
                  <select id={id} value={String(v ?? '')} disabled={disabled} aria-invalid={!!err} onChange={(e) => onChange(f.key, e.target.value)} className={cn(CONTROL, 'h-8')}>
                    {!f.required ? <option value="">Not set</option> : null}
                    {f.options?.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    id={id}
                    type={f.kind === 'number' ? 'number' : 'text'}
                    inputMode={f.kind === 'number' ? 'numeric' : undefined}
                    min={f.min}
                    max={f.max}
                    step={f.integer ? 1 : 'any'}
                    value={String(v ?? '')}
                    disabled={disabled}
                    aria-invalid={!!err}
                    aria-describedby={help ? `${id}-help` : undefined}
                    onChange={(e) => onChange(f.key, e.target.value)}
                    className={cn(CONTROL, 'h-8')}
                  />
                )}
              </>
            )}
            {help && f.kind !== 'boolean' ? (
              <p id={`${id}-help`} className={cn('text-caption', err ? 'text-danger-700' : 'text-muted')} role={err ? 'alert' : undefined}>
                {help}
              </p>
            ) : null}
            {err && f.kind === 'boolean' ? (
              <p className="text-caption text-danger-700" role="alert">
                {err}
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
