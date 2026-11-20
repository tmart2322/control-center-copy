// @vitest-environment jsdom
/**
 * Every toast can be closed: the × is drawn inline (it shows even when the icon sprite failed to load, as after a
 * server restart mid-page), and Escape closes a focused toast. The re-auth error toast offers the command it tells you
 * to copy, and goes away on its own.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement as h } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KeyboardProvider } from '@/client/keyboard/KeyboardProvider';
import { $, cleanup, click, render, waitFor } from '@/components/composer/__tests__/dom';
import { reauthErrorToast } from '@/components/health/derive';
import { vdpReauthPatch } from '@/components/settings/VdpReauthBlock';
import { toast, toastStore } from '../index';
import { Toaster } from '../Toaster';

const mount = () => render(h(QueryClientProvider, { client: new QueryClient() }, h(KeyboardProvider, null, h(Toaster))));

afterEach(async () => {
  act(() => toastStore.clear());
  await cleanup();
});

describe('Toaster', () => {
  it('a sticky error toast closes with its ×, drawn without the icon sprite', async () => {
    const { container } = await mount();
    act(() => void toast({ key: 't1', tone: 'error', title: 'Couldn’t start re-auth for VDP', body: 'Network error', durationMs: null }));
    const btn = await waitFor(() => $('[data-testid="toast-dismiss"]', container));
    expect(btn.querySelector('use')).toBeNull();
    expect(btn.querySelector('svg path')).not.toBeNull();
    await click(btn);
    await waitFor(() => !$('[data-testid="toast-dismiss"]', container));
  });

  it('Escape closes the toast that has focus', async () => {
    const { container } = await mount();
    act(() => void toast({ key: 't2', tone: 'error', title: 'Sticky', durationMs: null }));
    const btn = (await waitFor(() => $('[data-testid="toast-dismiss"]', container))) as HTMLButtonElement;
    act(() => {
      btn.focus();
      btn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    await waitFor(() => !$('[data-testid="toast-dismiss"]', container));
  });
});

describe('the re-auth error toast', () => {
  it('offers the command it mentions, and is not sticky', () => {
    const copy = vi.fn();
    const t = reauthErrorToast({ id: 'c1', label: 'VDP', reauth: { kind: 'refresh_script', label: 'Re-auth VDP', command: 'python3 ~/.claude/scripts/refresh_vdp_fir_cookie.py', instructions: null } }, 'Network error: Failed to fetch', copy);
    expect(t).toMatchObject({ tone: 'error', title: 'Couldn’t start re-auth for VDP', body: 'Network error: Failed to fetch. Copy the command and run it in Terminal instead.', durationMs: 20_000, action: { label: 'Copy command' } });
    t.action!.onClick();
    expect(copy).toHaveBeenCalledWith('python3 ~/.claude/scripts/refresh_vdp_fir_cookie.py');
    const noCmd = reauthErrorToast({ id: 'c2', label: 'Gmail', reauth: null }, 'Offline');
    expect(noCmd.body).toBe('Offline');
    expect(noCmd).not.toHaveProperty('action');
  });
});

describe('Settings ▸ Sources ▸ VDP re-auth', () => {
  const saved = { vdpRefreshScript: '~/.claude/scripts/refresh_vdp_fir_cookie.py', vdpPython: '' };
  it('saves only valid values that changed; an empty script means the default', () => {
    expect(vdpReauthPatch(saved, '~/tools/refresh.py', '')).toEqual({ vdpRefreshScript: '~/tools/refresh.py' });
    expect(vdpReauthPatch(saved, '', '/usr/bin/python3')).toEqual({ vdpPython: '/usr/bin/python3' });
    expect(vdpReauthPatch(saved, 'refresh.py', 'python3; x')).toEqual({});
    expect(vdpReauthPatch(saved, saved.vdpRefreshScript, '')).toEqual({});
  });
});
