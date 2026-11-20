/**
 * Claude-sessions replay: transcripts are append-only JSONL, so time travel is faithful. An index of each
 * transcript's line ends and timestamps (built once) lets a per-scenario snapshot directory be grown to "what
 * the file looked like at the simulated now": bytes up to the last line with timestamp ≤ now, mtime = that
 * line's time. The production ClaudeSessionsFetcher then reads the snapshot dir instead of ~/.claude/projects.
 * Limits (documented): the live-process registry (~/.claude/sessions) and the desktop index are not replayed.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { privDir, readJson, writePriv } from '../lib/paths';

export interface TranscriptIndex {
  files: Array<{ rel: string; size: number; marks: Array<[number, number]> }>; // [byteEnd, tsMs] per timestamped line
}

export function buildTranscriptIndex(opts: { projectsDir?: string; since: string; until: string; excludeDirs?: RegExp }): TranscriptIndex {
  const root = opts.projectsDir ?? path.join(os.homedir(), '.claude', 'projects');
  const since = Date.parse(opts.since);
  const until = Date.parse(opts.until);
  const out: TranscriptIndex = { files: [] };
  for (const d of fs.readdirSync(root)) {
    if (opts.excludeDirs?.test(d)) continue;
    const dir = path.join(root, d);
    let names: string[];
    try {
      names = fs.readdirSync(dir).filter((n) => n.endsWith('.jsonl'));
    } catch {
      continue;
    }
    for (const n of names) {
      const p = path.join(dir, n);
      const st = fs.statSync(p);
      if (st.mtimeMs < since) continue;
      const buf = fs.readFileSync(p);
      const marks: Array<[number, number]> = [];
      let start = 0;
      let lastTs = 0;
      for (let i = 0; i < buf.length; i++) {
        if (buf[i] !== 0x0a) continue;
        const line = buf.subarray(start, i).toString('utf8');
        const m = line.match(/"timestamp":"([^"]+)"/);
        const ts = m ? Date.parse(m[1]!) : NaN;
        if (Number.isFinite(ts)) lastTs = Math.max(lastTs, ts);
        if (lastTs) marks.push([i + 1, lastTs]);
        start = i + 1;
      }
      if (!marks.length || marks[0]![1] > until) continue;
      // Compact: keep only the last byte end per distinct timestamp second.
      const compact: Array<[number, number]> = [];
      for (const mk of marks) {
        const prev = compact[compact.length - 1];
        if (prev && Math.floor(prev[1] / 1000) === Math.floor(mk[1] / 1000)) prev[0] = mk[0];
        else compact.push([mk[0], mk[1]]);
      }
      out.files.push({ rel: path.join(d, n), size: buf.length, marks: compact });
    }
  }
  return out;
}

export function transcriptIndexFile(): string {
  return path.join(privDir('recordings', 'claude'), 'index.json');
}

export function loadTranscriptIndex(): TranscriptIndex {
  return readJson<TranscriptIndex>(transcriptIndexFile());
}

/** Grow `snapDir` to the simulated `nowMs` (append-only; never shrinks). Returns files touched. */
export function materialize(ix: TranscriptIndex, snapDir: string, nowMs: number, projectsDir = path.join(os.homedir(), '.claude', 'projects')): number {
  let touched = 0;
  for (const f of ix.files) {
    let end = 0;
    let at = 0;
    for (const [b, t] of f.marks) {
      if (t > nowMs) break;
      end = b;
      at = t;
    }
    if (!end) continue;
    const dst = path.join(snapDir, f.rel);
    const cur = fs.existsSync(dst) ? fs.statSync(dst).size : -1;
    if (cur >= end) continue;
    fs.mkdirSync(path.dirname(dst), { recursive: true, mode: 0o700 });
    const src = fs.openSync(path.join(projectsDir, f.rel), 'r');
    try {
      const from = Math.max(0, cur);
      const buf = Buffer.alloc(end - from);
      fs.readSync(src, buf, 0, buf.length, from);
      fs.appendFileSync(dst, buf, { mode: 0o600 });
    } finally {
      fs.closeSync(src);
    }
    fs.utimesSync(dst, new Date(at), new Date(at));
    touched++;
  }
  return touched;
}

export function writeTranscriptIndex(ix: TranscriptIndex): void {
  writePriv(transcriptIndexFile(), JSON.stringify(ix));
}
