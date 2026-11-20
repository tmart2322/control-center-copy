import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { classifyHeartbeat, HEARTBEAT_DEAD_MS, HEARTBEAT_FRESH_MS, HeartbeatWriter, readHeartbeat } from '../../src/ops/heartbeat';

let dir: string;
beforeEach(() => void (dir = mkdtempSync(join(tmpdir(), 'cc-hb-'))));
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('heartbeat', () => {
  it('writes a valid, private, atomically replaced file', () => {
    const path = join(dir, 'worker.heartbeat');
    let t = Date.parse('2026-11-05T12:00:00Z');
    const w = new HeartbeatWriter({ path, appVersion: '1.2.3', now: () => t });
    w.state = 'running';
    w.activeJobs = 2;
    w.beat();
    t += 15_000;
    w.beat();
    expect(statSync(path).mode & 0o777).toBe(0o600);
    const { hb, health } = readHeartbeat(path);
    expect(hb).toMatchObject({ v: 1, state: 'running', active_jobs: 2, app_version: '1.2.3', seq: 2, pid: process.pid, last_error_code: null });
    expect(hb!.instance_id.split(':').length).toBeGreaterThanOrEqual(3);
    expect(health === 'fresh' || health === 'dead' || health === 'stale').toBe(true);
  });

  it('classifies fresh / stale / dead by age', () => {
    const w = new HeartbeatWriter({ path: join(dir, 'h'), now: () => 1_000_000 });
    const hb = w.snapshot();
    const at = (ageMs: number) => classifyHeartbeat(hb, Date.parse(hb.beat_at) + ageMs).health;
    expect(at(1000)).toBe('fresh');
    expect(at(HEARTBEAT_FRESH_MS + 1)).toBe('stale');
    expect(at(HEARTBEAT_DEAD_MS + 1)).toBe('dead');
  });

  it('reports missing and invalid files', () => {
    expect(readHeartbeat(join(dir, 'nope')).health).toBe('missing');
    const bad = join(dir, 'bad');
    writeFileSync(bad, '{"v":2}');
    expect(readHeartbeat(bad).health).toBe('invalid');
  });

  it('stop() writes a final "stopped" beat', () => {
    const path = join(dir, 'h');
    const w = new HeartbeatWriter({ path });
    w.start();
    w.stop();
    expect(JSON.parse(readFileSync(path, 'utf8')).state).toBe('stopped');
  });

  it('never throws when the directory is unwritable', () => {
    const w = new HeartbeatWriter({ path: '/dev/null/nope/hb' });
    expect(() => w.beat()).not.toThrow();
  });

  it('calls onBeat so the worker can mirror to worker_instances', () => {
    const seen: number[] = [];
    const w = new HeartbeatWriter({ path: join(dir, 'h'), onBeat: (hb) => void seen.push(hb.seq) });
    w.beat();
    w.beat();
    expect(seen).toEqual([1, 2]);
  });
});
