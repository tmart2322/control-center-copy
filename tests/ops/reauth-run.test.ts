/**
 * Health ▸ re-auth runs the sign-in (src/reauth/run.ts, src/jobs/scan.ts reauthHandler):
 * - the job starts the connector's sign-in once, on its first attempt, then re-probes; retries only re-probe;
 * - VDP: the silent refresh first, the Terminal window when Okta wants MFA;
 * - a sign-in that could not begin (no script, no Python) fails the job with the reason instead of retrying;
 * - the starter reads Settings ▸ Sources (script, Python) at run time.
 * Fakes only: nothing opens Terminal or runs a script.
 */
import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_SCANNING_SETTINGS, ScanningSettings, SETTINGS_SECTION_SCHEMAS, vdpRefreshCommand } from '../../src/contract';
import { reauthHandler, type ReauthStarter, type ScanHandlerDeps } from '../../src/jobs/scan';
import { JobError, type JobContext } from '../../src/jobs/types';
import { reauthStarter, runConnectorReauth } from '../../src/reauth/run';
import type { ReauthHandler, ReauthKind, ReauthResult } from '../../src/reauth/types';

function handlers(acts: Partial<Record<ReauthKind, (o: { window?: boolean }) => ReauthResult>>) {
  const calls: Array<{ kind: ReauthKind; window: boolean }> = [];
  const mk = (kind: ReauthKind): ReauthHandler => ({
    kind,
    status: async () => ({ kind, state: 'ok', message: '' }),
    describe: () => ({ command: '', instructions: '' }),
    act: async (o) => {
      calls.push({ kind, window: !!o.window });
      return acts[kind]?.(o) ?? { kind, status: 'launched', message: 'ok' };
    },
  });
  const all = Object.fromEntries((['slack', 'org62', 'vdp', 'google', 'devbar_signin', 'devbar_restart'] as ReauthKind[]).map((k) => [k, mk(k)])) as Record<ReauthKind, ReauthHandler>;
  return { all, calls };
}

describe('runConnectorReauth', () => {
  it('VDP: the silent refresh, then the Terminal window only when Okta wants MFA', async () => {
    const mfa = handlers({ vdp: (o) => (o.window ? { kind: 'vdp', status: 'launched', message: 'Terminal opened' } : { kind: 'vdp', status: 'needs_user', message: 'Okta needs MFA.' }) });
    expect(await runConnectorReauth(mfa.all, 'vdp')).toMatchObject({ status: 'launched' });
    expect(mfa.calls).toEqual([{ kind: 'vdp', window: false }, { kind: 'vdp', window: true }]);
    const silent = handlers({ vdp: () => ({ kind: 'vdp', status: 'refreshed', message: 'VDP cookie refreshed' }) });
    expect(await runConnectorReauth(silent.all, 'vdp')).toMatchObject({ status: 'refreshed' });
    expect(silent.calls).toEqual([{ kind: 'vdp', window: false }]);
    // off the network is not MFA: no window
    const off = handlers({ vdp: () => ({ kind: 'vdp', status: 'needs_user', message: 'VDP is unreachable. Connect to the corporate network.' }) });
    await runConnectorReauth(off.all, 'vdp');
    expect(off.calls).toEqual([{ kind: 'vdp', window: false }]);
  });

  it('routes each connector to its sign-in, and nothing for one without', async () => {
    const h = handlers({});
    for (const c of ['slack', 'org62', 'gmail', 'calendar', 'drive', 'gemini_notes']) await runConnectorReauth(h.all, c);
    expect(h.calls.map((c) => c.kind)).toEqual(['slack', 'org62', 'google', 'google', 'google', 'google']);
    expect(await runConnectorReauth(h.all, 'claude_sessions')).toBeNull();
  });
});

describe('reauthStarter reads Settings ▸ Sources at run time', () => {
  const ctxWith = (v: unknown) => ({ userId: 'u1', db: { execute: async () => ({ rows: v === undefined ? [] : [{ v }] }) } }) as unknown as JobContext;
  it('passes the saved script and Python, and ignores invalid or empty values', async () => {
    const seen: unknown[] = [];
    const start = reauthStarter((vdp) => (seen.push(vdp), handlers({ vdp: () => ({ kind: 'vdp', status: 'refreshed', message: '' }) }).all));
    await start('vdp', ctxWith({ vdpRefreshScript: '~/tools/refresh.py', vdpPython: '/usr/bin/python3' }));
    await start('vdp', ctxWith({ vdpRefreshScript: 'rm -rf /; x.py', vdpPython: '' }));
    await start('vdp', ctxWith(undefined));
    expect(seen).toEqual([{ script: '~/tools/refresh.py', python: '/usr/bin/python3' }, {}, {}]);
  });
});

describe('connector.reauth job', () => {
  function setup(probe: () => Array<{ status: string; errorClass?: string }>) {
    const runScope = vi.fn(async () => probe());
    const deps = {
      scanner: { spec: () => ({ type: 'traversal' }), resumeConnector: () => true, scopesOf: () => ['mine'], runScope },
      queue: {},
    } as unknown as ScanHandlerDeps;
    const ctx = (attempts: number) => ({ job: { id: 1, attempts, payload: { connectorId: 'vdp' } }, userId: 'u1', log: () => undefined, signal: new AbortController().signal, db: { execute: async () => ({ rows: [] }) } }) as unknown as JobContext;
    return { deps, ctx, runScope };
  }

  it('starts the sign-in on the first attempt only, then re-probes until it works', async () => {
    const start = vi.fn<ReauthStarter>(async () => ({ status: 'launched', message: 'Terminal opened' }));
    let ok = false;
    const s = setup(() => [ok ? { status: 'succeeded' } : { status: 'failed', errorClass: 'auth' }]);
    const h = reauthHandler(s.deps, start);
    await expect(h(s.ctx(1))).rejects.toMatchObject({ errorClass: 'transient', opts: { code: 'reauth_pending' } });
    await expect(h(s.ctx(2))).rejects.toBeInstanceOf(JobError);
    ok = true;
    expect(await h(s.ctx(3))).toMatchObject({ status: 'succeeded', connector: 'vdp', started: null });
    expect(start).toHaveBeenCalledTimes(1);
    expect(start.mock.calls[0]![0]).toBe('vdp');
  });

  it('a sign-in that could not begin fails with the reason instead of retrying', async () => {
    const start = vi.fn<ReauthStarter>(async () => ({ status: 'unavailable', message: 'The VDP refresh script is not at /x. Set where it lives in Settings ▸ Sources.' }));
    const s = setup(() => [{ status: 'failed', errorClass: 'auth' }]);
    await expect(reauthHandler(s.deps, start)(s.ctx(1))).rejects.toMatchObject({ errorClass: 'validation', opts: { code: 'reauth_not_started' }, message: expect.stringContaining('Settings ▸ Sources') });
    // the probe still ran, so the connector is back to "needs re-auth" rather than stuck catching up
    expect(s.runScope).toHaveBeenCalledTimes(1);
  });

  it('a silent refresh that worked succeeds at once', async () => {
    const s = setup(() => [{ status: 'succeeded' }]);
    expect(await reauthHandler(s.deps, async () => ({ status: 'refreshed', message: '' }))(s.ctx(1))).toMatchObject({ status: 'succeeded', started: 'refreshed' });
  });
});

describe('the setting', () => {
  it('defaults to the usual script and an automatic Python; the patch refuses shell text', () => {
    expect(ScanningSettings.parse({ version: 1 })).toMatchObject({ vdpRefreshScript: '~/.claude/scripts/refresh_vdp_fir_cookie.py', vdpPython: '' });
    expect(DEFAULT_SCANNING_SETTINGS.vdpRefreshScript).toBe('~/.claude/scripts/refresh_vdp_fir_cookie.py');
    const patch = SETTINGS_SECTION_SCHEMAS.scanning;
    expect(patch.safeParse({ vdpRefreshScript: '~/My Scripts/refresh.py' }).success).toBe(true);
    expect(patch.safeParse({ vdpRefreshScript: '/opt/vdp/refresh.py', vdpPython: '/usr/bin/python3' }).success).toBe(true);
    for (const bad of ['refresh.py', '~/x.sh', "~/x'; rm -rf ~; '.py", '~/$(whoami).py']) expect(patch.safeParse({ vdpRefreshScript: bad }).success).toBe(false);
    expect(patch.safeParse({ vdpPython: 'python3; curl x' }).success).toBe(false);
  });

  it('Health shows the configured command (quoted when the path has a space)', () => {
    expect(vdpRefreshCommand(DEFAULT_SCANNING_SETTINGS)).toBe('python3 ~/.claude/scripts/refresh_vdp_fir_cookie.py');
    expect(vdpRefreshCommand({ vdpRefreshScript: '~/My Scripts/r.py', vdpPython: '/usr/bin/python3' })).toBe('/usr/bin/python3 "$HOME/My Scripts/r.py"');
    expect(vdpRefreshCommand(null)).toBe('python3 ~/.claude/scripts/refresh_vdp_fir_cookie.py');
  });
});

describe('Health ▸ VDP shows the configured refresh command', () => {
  it('replaces only VDP’s refresh_script command; other connectors and an explicit config keep theirs', async () => {
    const { reauthOf, DEFAULT_REAUTH } = await import('../../src/server/datasource/db/store/health');
    expect(reauthOf('vdp', undefined, '/usr/bin/python3 ~/tools/r.py')).toMatchObject({ kind: 'refresh_script', command: '/usr/bin/python3 ~/tools/r.py' });
    expect(reauthOf('vdp', undefined, undefined)).toEqual(DEFAULT_REAUTH.vdp);
    expect(reauthOf('slack', undefined, '/usr/bin/python3 ~/tools/r.py')).toEqual(DEFAULT_REAUTH.slack);
  });
});
