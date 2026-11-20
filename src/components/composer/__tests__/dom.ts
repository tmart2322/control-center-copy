/**
 * Minimal React DOM test harness (react-dom/client + act) so component tests need no extra dependency.
 * Use from files marked `// @vitest-environment jsdom`.
 */
import * as React from 'react';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// vitest.config has no JSX setting, so esbuild emits classic `React.createElement` for .tsx: provide it.
(globalThis as { React?: typeof React }).React = React;

export interface Rendered {
  container: HTMLElement;
  root: Root;
  unmount: () => Promise<void>;
}

const mounted: Rendered[] = [];

export async function render(el: ReactElement): Promise<Rendered> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(el));
  const r: Rendered = {
    container,
    root,
    unmount: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
  mounted.push(r);
  return r;
}

export async function cleanup(): Promise<void> {
  while (mounted.length) await mounted.pop()!.unmount();
  document.body.innerHTML = '';
}

/** Poll (inside act) until fn returns a truthy value. */
export async function waitFor<T>(fn: () => T | null | undefined | false, timeoutMs = 4000): Promise<T> {
  const end = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < end) {
    try {
      const v = fn();
      if (v) return v;
    } catch (e) {
      lastErr = e;
    }
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
  }
  throw lastErr ?? new Error('waitFor: timed out');
}

export async function click(el: Element | null | undefined): Promise<void> {
  if (!el) throw new Error('click: no element');
  await act(async () => {
    (el as HTMLElement).click();
  });
}

export const $ = (sel: string, root: ParentNode = document) => root.querySelector<HTMLElement>(sel);
export const $$ = (sel: string, root: ParentNode = document) => [...root.querySelectorAll<HTMLElement>(sel)];
