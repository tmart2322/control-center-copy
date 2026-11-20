import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExecFn } from '../../src/ops/exec';
import { buildNotifyCommand, clickUrl, isQuietNow, Notifier, sanitize } from '../../src/ops/notify';

let dir: string;
beforeEach(() => void (dir = mkdtempSync(join(tmpdir(), 'cc-notify-'))));
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const okExec = () => vi.fn<ExecFn>(async () => ({ code: 0, stdout: '', stderr: '', timedOut: false }));
const make = (over: Partial<ConstructorParameters<typeof Notifier>[0]> = {}, at = new Date(2026, 10, 5, 14, 0)) => {
  const exec = okExec();
  const clock = { t: at };
  const n = new Notifier({ statePath: join(dir, 's.json'), exec, now: () => clock.t, terminalNotifierPath: null, ...over });
  return { n, exec, clock };
};
const req = { kind: 'connector_broken', entityId: 'slack', transition: 'auth_needed', title: 'Slack needs sign-in', body: 'Open Health' } as const;

describe('command construction', () => {
  it('passes text as osascript argv, never inside the script', () => {
    const c = buildNotifyCommand({ title: 'T"; do shell script "x', body: 'B\\"', url: null, group: 'g', terminalNotifier: null });
    expect(c.via).toBe('osascript');
    const script = c.args.filter((_, i) => c.args[i - 1] === '-e').join('\n');
    expect(script).not.toContain('do shell script');
    expect(c.args.slice(-2)).toEqual(['B\\"', 'T"; do shell script "x']);
  });
  it('uses terminal-notifier with -open when available', () => {
    const c = buildNotifyCommand({ title: 't', body: 'b', url: 'http://localhost:4327/health', group: 'g', terminalNotifier: '/opt/homebrew/bin/terminal-notifier' });
    expect(c).toMatchObject({ via: 'terminal-notifier', clickable: true });
    expect(c.args).toContain('-open');
  });
  it('only links to localhost:4327', () => {
    expect(clickUrl('/health')).toBe('http://localhost:4327/health');
    expect(clickUrl('http://localhost:4327/agents?run=3')).toBe('http://localhost:4327/agents?run=3');
    expect(clickUrl('https://evil.example/x')).toBeNull();
    expect(clickUrl('http://localhost:9999/x')).toBeNull();
    expect(clickUrl('file:///etc/passwd')).toBeNull();
  });
  it('redacts credential-like text and truncates', () => {
    expect(sanitize('token: abc123 and xoxb-123-456-secret and Bearer abcdef.ghi')).not.toMatch(/abc123|xoxb-|abcdef/);
    expect(sanitize('x'.repeat(500)).length).toBeLessThanOrEqual(160);
  });
});

describe('quiet hours', () => {
  it('handles windows that wrap midnight', () => {
    const q = { start: '21:00', end: '07:00' };
    expect(isQuietNow(q, new Date(2026, 10, 5, 22, 0))).toBe(true);
    expect(isQuietNow(q, new Date(2026, 10, 5, 3, 0))).toBe(true);
    expect(isQuietNow(q, new Date(2026, 10, 5, 7, 0))).toBe(false);
    expect(isQuietNow(q, new Date(2026, 10, 5, 12, 0))).toBe(false);
    expect(isQuietNow(null, new Date())).toBe(false);
  });
});

describe('Notifier', () => {
  it('sends once per transition, again after resolve()', async () => {
    const { n, exec } = make();
    expect((await n.notify(req)).sent).toBe(true);
    expect(await n.notify(req)).toMatchObject({ sent: false, reason: 'deduped' });
    expect(exec).toHaveBeenCalledTimes(1);
    n.resolve(req); // connector recovered
    expect((await n.notify(req)).sent).toBe(true);
    expect(exec).toHaveBeenCalledTimes(2);
  });

  it('dedupes across processes (state file)', async () => {
    const a = make();
    await a.n.notify(req);
    const b = make();
    expect(await b.n.notify(req)).toMatchObject({ reason: 'deduped' });
  });

  it('suppresses during quiet hours without remembering, so it can fire later', async () => {
    const { n, clock } = make({ quietHours: { start: '21:00', end: '07:00' } }, new Date(2026, 10, 5, 23, 0));
    expect(await n.notify(req)).toMatchObject({ sent: false, reason: 'quiet_hours' });
    clock.t = new Date(2026, 10, 6, 8, 0);
    expect((await n.notify(req)).sent).toBe(true);
  });

  it('rate limits per rolling hour', async () => {
    const { n } = make({ maxPerHour: 2 });
    expect((await n.notify({ ...req, entityId: 'a' })).sent).toBe(true);
    expect((await n.notify({ ...req, entityId: 'b' })).sent).toBe(true);
    expect(await n.notify({ ...req, entityId: 'c' })).toMatchObject({ reason: 'rate_limited' });
  });

  it('brief_high needs opt-in; waiting_on_you is skipped while the app is focused', async () => {
    const brief = { kind: 'brief_high', entityId: 'b1', transition: 'ready', title: 'Brief', body: 'High relevance' } as const;
    expect(await make().n.notify(brief)).toMatchObject({ reason: 'opted_out' });
    expect((await make({ briefHighOptIn: true }).n.notify(brief)).sent).toBe(true);
    const wait = { kind: 'waiting_on_you', entityId: 's1', transition: 'waiting', title: 'Claude is waiting', body: 'Session s1' } as const;
    expect(await make().n.notify({ ...wait, appFocused: true })).toMatchObject({ reason: 'app_focused' });
    expect((await make().n.notify({ ...wait, appFocused: false })).sent).toBe(true);
  });

  it('rejects kinds outside the allowed four', async () => {
    const r = await make().n.notify({ ...req, kind: 'new_email' as never });
    expect(r).toMatchObject({ sent: false, reason: 'invalid_kind' });
  });

  it('does not remember a failed send', async () => {
    const exec = vi.fn<ExecFn>(async () => ({ code: 1, stdout: '', stderr: '', timedOut: false }));
    const n = new Notifier({ statePath: join(dir, 'f.json'), exec, terminalNotifierPath: null });
    expect(await n.notify(req)).toMatchObject({ reason: 'send_failed' });
    exec.mockResolvedValue({ code: 0, stdout: '', stderr: '', timedOut: false });
    expect((await n.notify(req)).sent).toBe(true);
  });
});
