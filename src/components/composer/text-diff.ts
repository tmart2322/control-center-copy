/** Word-level diff (LCS) for "Changed elsewhere" and proposals without a server textDiff. */
export type DiffOp = { op: 'equal' | 'insert' | 'delete'; text: string };

export function wordDiff(a: string, b: string): DiffOp[] {
  const x = a.split(/(\s+)/);
  const y = b.split(/(\s+)/);
  const n = x.length;
  const m = y.length;
  if (n * m > 250_000) return [{ op: 'delete', text: a }, { op: 'insert', text: b }];
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i]![j] = x[i] === y[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  const out: DiffOp[] = [];
  const push = (op: DiffOp['op'], text: string) => {
    if (!text) return;
    const last = out[out.length - 1];
    if (last && last.op === op) last.text += text;
    else out.push({ op, text });
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) {
      push('equal', x[i]!);
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) push('delete', x[i++]!);
    else push('insert', y[j++]!);
  }
  while (i < n) push('delete', x[i++]!);
  while (j < m) push('insert', y[j++]!);
  return out;
}

/** Line-level changes (theirs-only lines as deletes, yours-only lines as inserts). Reads better for conflicts. */
export function lineChanges(theirs: string, yours: string): DiffOp[] {
  const split = (s: string) => s.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const a = split(theirs);
  const b = split(yours);
  const inB = new Set(b);
  const inA = new Set(a);
  return [...a.filter((l) => !inB.has(l)).map((text) => ({ op: 'delete' as const, text })), ...b.filter((l) => !inA.has(l)).map((text) => ({ op: 'insert' as const, text }))];
}
