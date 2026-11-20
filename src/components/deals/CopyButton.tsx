'use client';
/** Copy text to the clipboard with a short "Copied" confirmation. Never sends anything anywhere. */
import { useEffect, useRef, useState } from 'react';
import { Button, type ButtonProps } from '@/ui';

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export function CopyButton({ text, label = 'Copy', size = 'xs', variant = 'secondary', ...rest }: { text: string; label?: string } & Omit<ButtonProps, 'onClick' | 'children'>) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  return (
    <Button
      size={size}
      variant={variant}
      icon={state === 'copied' ? 'check' : 'copy'}
      aria-live="polite"
      data-copy-state={state}
      onClick={async (e) => {
        e.stopPropagation();
        setState((await copyText(text)) ? 'copied' : 'failed');
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setState('idle'), 1800);
      }}
      {...rest}
    >
      {state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : label}
    </Button>
  );
}
