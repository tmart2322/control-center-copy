/**
 * D0 guard (audit 2026-11-13, lane D): every model call the app books goes through one of the two ledger writers,
 * which require its audit fields by type and note any gap at run time (tests/setup/ledger-gaps.ts fails the test).
 * This file fails when a new writer bypasses them, and checks the gap rules themselves.
 */
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { ledgerGaps, noteLedgerGaps, takeLedgerGaps } from '../../src/db/ledger';

const ROOT = path.resolve(__dirname, '../..');
/** The two writers: insertLlmCall, and the scanner store's recordSpend (scan runs book per pass). */
const WRITERS = new Set(['src/db/ledger.ts', 'src/scanner/store-db.ts']);

function files(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...files(rel));
    else if (/\.(ts|tsx|mjs|js)$/.test(e.name) && !/\.test\.ts$|\.spec\.ts$/.test(e.name)) out.push(rel);
  }
  return out;
}

describe('one way into llm_calls', () => {
  it('no code inserts into llm_calls except the two ledger writers', () => {
    const raw = [...files('src'), ...files('scripts'), ...files('app')].filter((f) => !WRITERS.has(f) && /insert\s+into\s+llm_calls/i.test(fs.readFileSync(path.join(ROOT, f), 'utf8')));
    expect(raw, 'book a model call through insertLlmCall (src/db/ledger.ts) or the scanner store’s recordSpend').toEqual([]);
  });
});

describe('a booked call is complete', () => {
  const full = { trigger: 'schedule', modelReason: 'default', outcome: 'ok', contentHash: 'h', costUsd: 0.01, inputTokens: 10, outputTokens: 2 };
  it('every audit field, and tokens on a call that cost money', () => {
    expect(ledgerGaps(full)).toEqual([]);
    expect(ledgerGaps({ ...full, trigger: '' })).toEqual(['no trigger']);
    expect(ledgerGaps({ ...full, modelReason: undefined, outcome: undefined, contentHash: undefined })).toEqual(['no modelReason', 'no outcome', 'no contentHash']);
    expect(ledgerGaps({ ...full, inputTokens: 0, outputTokens: 0 })).toEqual(['cost without tokens']);
    expect(ledgerGaps({ ...full, inputTokens: 0, outputTokens: 0, cacheReadTokens: 900 })).toEqual([]); // a cache hit is tokens
    expect(ledgerGaps({ ...full, costUsd: 0, inputTokens: 0, outputTokens: 0 })).toEqual([]); // a call that failed before it cost
  });
  it('a gap is noted (and the test hook fails on it); taking them clears them', () => {
    noteLedgerGaps('test', { ...full, outcome: '' });
    expect(takeLedgerGaps()).toEqual(['test: no outcome']);
    expect(takeLedgerGaps()).toEqual([]);
  });
});
