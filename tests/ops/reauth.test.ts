import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExecFn, ExecResult } from '../../src/ops/exec';
import { parseMcpList, readVdpInfo } from '../../src/ops/mcp';
import { allHandlers, devbarHandler, org62Handler, slackHandler, vdpHandler } from '../../src/reauth/handlers';
import { loginCommand, terminalAppleScriptArgs } from '../../src/reauth/terminal';
import type { ReauthDeps } from '../../src/reauth/types';

let dir: string;
const NOW = 1_800_000_000_000;
const PAT = 'Bearer super-secret-pat-value';

const jwt = (exp: number) => `h.${Buffer.from(JSON.stringify({ exp })).toString('base64url')}.s`;
const res = (over: Partial<ExecResult> = {}): ExecResult => ({ code: 0, stdout: '', stderr: '', timedOut: false, ...over });

function deps(over: Partial<ReauthDeps> = {}): ReauthDeps & { openTerminal: ReturnType<typeof vi.fn>; spawnDetached: ReturnType<typeof vi.fn> } {
  return {
    exec: vi.fn<ExecFn>(async () => res()),
    openTerminal: vi.fn(async () => ({ ok: true })),
    spawnDetached: vi.fn(() => ({ ok: true })),
    now: () => NOW,
    home: dir,
    claudeJson: join(dir, 'claude.json'),
    exists: () => true,
    ...over,
  } as never;
}
const writeClaudeJson = (cookieExpOffsetS: number | null) =>
  writeFileSync(
    join(dir, 'claude.json'),
    JSON.stringify({
      mcpServers: { 'vdp-app-fir': { type: 'http', url: 'https://x', headers: { Authorization: PAT, ...(cookieExpOffsetS === null ? {} : { Cookie: `central_proxy_session=${jwt(NOW / 1000 + cookieExpOffsetS)}` }) } } },
    }),
  );

beforeEach(() => void (dir = mkdtempSync(join(tmpdir(), 'cc-reauth-'))));
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('command construction (Terminal is never opened here)', () => {
  it('builds the login command and rejects unsafe names', () => {
    expect(loginCommand('slack')).toBe('claude mcp login slack');
    expect(loginCommand('Org62-Sobject-Read')).toBe('claude mcp login Org62-Sobject-Read');
    expect(() => loginCommand('slack; rm -rf ~')).toThrow();
    expect(() => loginCommand('$(whoami)')).toThrow();
  });
  it('passes the command to AppleScript as an argument', () => {
    const args = terminalAppleScriptArgs('claude mcp login slack');
    expect(args.at(-1)).toBe('claude mcp login slack');
    expect(args.join(' ')).toContain('do script (item 1 of argv)');
    expect(args.join(' ')).toContain('tell application "Terminal"');
  });
});

describe('Slack / Org62', () => {
  it('does nothing without confirm', async () => {
    const d = deps();
    const r = await slackHandler(d).act({ confirm: false });
    expect(r).toMatchObject({ kind: 'slack', status: 'needs_confirm', command: 'claude mcp login slack' });
    expect(d.openTerminal).not.toHaveBeenCalled();
  });
  it('opens Terminal with the pre-typed command when confirmed', async () => {
    const d = deps();
    const r = await org62Handler(d).act({ confirm: true });
    expect(d.openTerminal).toHaveBeenCalledWith('claude mcp login Org62-Sobject-Read');
    expect(r).toMatchObject({ kind: 'org62', status: 'launched' });
  });
  it('reports failure with a copyable command when Terminal cannot open', async () => {
    const d = deps({ openTerminal: vi.fn(async () => ({ ok: false })) });
    const r = await slackHandler(d).act({ confirm: true });
    expect(r.status).toBe('failed');
    expect(r.message).toContain('claude mcp login slack');
  });
  it('status maps claude mcp list output without triggering auth', async () => {
    const out = ['Checking MCP server health…', '', 'slack: https://mcp.slack.com/mcp (HTTP) - ! Needs authentication', 'Org62-Sobject-Read: https://x/y (HTTP) - ✔ Connected', 'vdp-app-fir: https://z (HTTP) - ✗ Failed to connect'].join('\n');
    const d = deps({ exec: vi.fn<ExecFn>(async () => res({ stdout: out })) });
    expect((await slackHandler(d).status()).state).toBe('auth_needed');
    expect((await org62Handler(d).status()).state).toBe('ok');
    expect(d.exec).toHaveBeenCalledWith('claude', ['mcp', 'list'], expect.anything());
    expect(parseMcpList(out).map((s) => s.state)).toEqual(['needs_auth', 'connected', 'failed']);
  });
});

describe('VDP', () => {
  const script = '/home/x/.claude/scripts/refresh_vdp_fir_cookie.py';
  it('status decodes the cookie locally and never exposes values', async () => {
    writeClaudeJson(3600);
    expect((await vdpHandler(deps(), { script }).status()).state).toBe('ok');
    writeClaudeJson(-60);
    const s = await vdpHandler(deps(), { script }).status();
    expect(s.state).toBe('auth_needed');
    expect(JSON.stringify(s)).not.toContain('super-secret');
    expect(readVdpInfo({ claudeJson: join(dir, 'claude.json'), now: () => NOW })).toMatchObject({ hasPat: true, hasCookie: true });
  });
  it('silent refresh: detects the MFA marker even though the script exits 0', async () => {
    writeClaudeJson(-60);
    const exec = vi.fn<ExecFn>(async () => res({ stdout: 'refreshing...\nOkta needs MFA; skipped (--no-window). Run without it to sign in.\n' }));
    const r = await vdpHandler(deps({ exec }), { script, python: 'python3', lockPath: join(dir, 'lock') }).act({ confirm: true });
    expect(r.status).toBe('needs_user');
    expect(r.message).toContain('MFA');
    expect(r.command).toBe(`python3 ${script}`);
    expect(exec).toHaveBeenCalledWith('python3', [script, '--no-window'], expect.anything());
  });
  it('reports refreshed only when the cookie is actually valid afterwards', async () => {
    writeClaudeJson(-60);
    const exec = vi.fn<ExecFn>(async () => {
      writeClaudeJson(3500); // the script patched ~/.claude.json
      return res({ stdout: 'cookie refreshed (3500s remaining)\n' });
    });
    const r = await vdpHandler(deps({ exec }), { script, lockPath: join(dir, 'lock') }).act({ confirm: true });
    expect(r.status).toBe('refreshed');
    const stale = vi.fn<ExecFn>(async () => res({ stdout: 'ok\n' })); // exit 0 but nothing changed
    writeClaudeJson(-60);
    expect((await vdpHandler(deps({ exec: stale }), { script, lockPath: join(dir, 'lock2') }).act({ confirm: true })).status).toBe('failed');
  });
  it('never runs without confirm; window mode goes through Terminal', async () => {
    const d = deps();
    expect((await vdpHandler(d, { script }).act({ confirm: false })).status).toBe('needs_confirm');
    expect(d.exec).not.toHaveBeenCalled();
    await vdpHandler(d, { script, python: 'python3' }).act({ confirm: true, window: true });
    expect(d.openTerminal).toHaveBeenCalledWith(`python3 ${script}`);
  });
  it('unavailable when python3 is missing; refuses a concurrent run', async () => {
    writeClaudeJson(-60);
    const exec = vi.fn<ExecFn>(async () => res({ code: null, spawnError: 'ENOENT' }));
    expect((await vdpHandler(deps({ exec }), { script, lockPath: join(dir, 'l3') }).act({ confirm: true })).status).toBe('unavailable');
    writeFileSync(join(dir, 'l4'), '');
    expect((await vdpHandler(deps(), { script, lockPath: join(dir, 'l4') }).act({ confirm: true })).status).toBe('failed');
  });
});

describe('VDP: where the script lives and which Python runs it (Settings ▸ Sources)', () => {
  it('expands ~/ to the home folder and quotes a path with spaces for Terminal', async () => {
    const d = deps();
    await vdpHandler(d, { script: '~/My Scripts/refresh.py', python: '/usr/bin/python3' }).act({ confirm: true, window: true });
    expect(d.openTerminal).toHaveBeenCalledWith(`/usr/bin/python3 '${join(dir, 'My Scripts/refresh.py')}'`);
  });

  it('without a configured Python, uses the first python3 that has Playwright', async () => {
    writeClaudeJson(-60);
    const exec = vi.fn<ExecFn>(async (cmd, args) => (args[0] === '-c' ? res({ code: cmd === '/usr/bin/python3' ? 1 : 0 }) : res({ stdout: 'Okta needs MFA; skipped\n' })));
    const r = await vdpHandler(deps({ exec }), { script: '/x/refresh.py', lockPath: join(dir, 'lp') }).act({ confirm: true });
    expect(r.status).toBe('needs_user');
    // /usr/bin/python3 has no Playwright here; plain python3 does
    expect(exec).toHaveBeenCalledWith('python3', ['/x/refresh.py', '--no-window'], expect.anything());
    expect(r.command).toBe('python3 /x/refresh.py');
  });

  it('says so when no python3 has Playwright, or the script is not where the setting says', async () => {
    const none = vi.fn<ExecFn>(async () => res({ code: 1 }));
    const r = await vdpHandler(deps({ exec: none }), { script: '/x/refresh.py' }).act({ confirm: true });
    expect(r).toMatchObject({ status: 'unavailable', message: expect.stringContaining('Playwright') });
    const gone = await vdpHandler(deps({ exists: () => false }), { script: '~/nowhere/refresh.py' }).act({ confirm: true });
    expect(gone).toMatchObject({ status: 'unavailable', message: expect.stringContaining('Settings ▸ Sources') });
    expect(gone.message).toContain(join(dir, 'nowhere/refresh.py'));
  });

  it('defaults to ~/.claude/scripts/refresh_vdp_fir_cookie.py', () => {
    expect(vdpHandler(deps(), {}).describe().command).toBe(`python3 ${join(dir, '.claude/scripts/refresh_vdp_fir_cookie.py')}`);
  });
});

describe('Google / devbar', () => {
  const json = (m: Record<string, unknown>): ExecFn => async (_c, a) => res({ stdout: JSON.stringify(a[0] === 'auth' ? m.auth : m.gw) });
  it('status walks signed-out, daemon-down, connected', async () => {
    expect((await devbarHandler(deps({ exec: json({ auth: { authenticated: false } }) })).status()).state).toBe('auth_needed');
    expect((await devbarHandler(deps({ exec: json({ auth: { authenticated: true }, gw: { listener_ok: false } }) })).status()).state).toBe('offline');
    expect((await devbarHandler(deps({ exec: json({ auth: { authenticated: true }, gw: { listener_ok: true, upstream_ok: true, auth_ok: true } }) })).status()).state).toBe('ok');
  });
  it('constructs the connect action and only spawns when confirmed', async () => {
    const d = deps();
    const h = devbarHandler(d, 'google');
    expect(h.describe().command).toBe('devbar mcpgw connectors connect google-workspace-readonly');
    expect((await h.act({ confirm: false })).status).toBe('needs_confirm');
    expect(d.spawnDetached).not.toHaveBeenCalled();
    expect((await h.act({ confirm: true })).status).toBe('launched');
    expect(d.spawnDetached).toHaveBeenCalledWith('devbar', ['mcpgw', 'connectors', 'connect', 'google-workspace-readonly']);
  });
  it('exposes every kind with the {kind,status,message} result shape', async () => {
    const hs = allHandlers(deps());
    expect(Object.keys(hs).sort()).toEqual(['devbar_restart', 'devbar_signin', 'google', 'org62', 'slack', 'vdp']);
    for (const h of Object.values(hs)) expect(await h.act({ confirm: false })).toEqual(expect.objectContaining({ kind: h.kind, status: 'needs_confirm', message: expect.any(String) }));
  });
});
