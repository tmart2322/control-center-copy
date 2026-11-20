/**
 * A small SOQL evaluator over recorded Org62 rows (replay of `soqlQuery`). Supports what the scan-org62 skill
 * writes: SELECT <fields incl. relationship paths> FROM <object> [WHERE <expr>] [ORDER BY f [ASC|DESC], …]
 * [LIMIT n]; expressions with AND / OR / NOT / parentheses; =, !=, <>, <, <=, >, >=, IN (…), NOT IN (…), LIKE;
 * string, number, boolean, null, date and datetime literals, and LAST_N_DAYS:n / TODAY / YESTERDAY relative to
 * the SIMULATED now. Anything else is a `ReplayMiss` (a harness gap, never a silent wrong answer).
 */
import { ReplayMiss } from './slack';

export type Row = Record<string, unknown>;

type Tok = { t: 'id' | 'str' | 'num' | 'op' | 'lp' | 'rp' | 'comma' | 'kw'; v: string };

const KW = new Set(['SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'IN', 'LIKE', 'ORDER', 'BY', 'ASC', 'DESC', 'LIMIT', 'NULLS', 'FIRST', 'LAST', 'TRUE', 'FALSE', 'NULL']);

export function tokenize(q: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < q.length) {
    const c = q[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === "'") {
      let j = i + 1;
      let s = '';
      while (j < q.length && q[j] !== "'") {
        if (q[j] === '\\' && j + 1 < q.length) {
          s += q[j + 1];
          j += 2;
        } else s += q[j++];
      }
      out.push({ t: 'str', v: s });
      i = j + 1;
      continue;
    }
    if (c === '(') {
      out.push({ t: 'lp', v: c });
      i++;
      continue;
    }
    if (c === ')') {
      out.push({ t: 'rp', v: c });
      i++;
      continue;
    }
    if (c === ',') {
      out.push({ t: 'comma', v: c });
      i++;
      continue;
    }
    const op = q.slice(i).match(/^(<=|>=|!=|<>|=|<|>)/);
    if (op) {
      out.push({ t: 'op', v: op[1] === '<>' ? '!=' : op[1]! });
      i += op[1]!.length;
      continue;
    }
    // Datetime / date literal, LAST_N_DAYS:n, numbers, identifiers (dotted paths, __c).
    const lit = q.slice(i).match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2}))/);
    if (lit) {
      out.push({ t: 'str', v: `@dt:${lit[1]}` });
      i += lit[1]!.length;
      continue;
    }
    const date = q.slice(i).match(/^(\d{4}-\d{2}-\d{2})(?![\dT])/);
    if (date) {
      out.push({ t: 'str', v: `@d:${date[1]}` });
      i += date[1]!.length;
      continue;
    }
    const num = q.slice(i).match(/^-?\d+(?:\.\d+)?/);
    if (num) {
      out.push({ t: 'num', v: num[0] });
      i += num[0].length;
      continue;
    }
    const id = q.slice(i).match(/^[A-Za-z_][A-Za-z0-9_.]*(?::\d+)?/);
    if (id) {
      const up = id[0].toUpperCase();
      out.push(KW.has(up) ? { t: 'kw', v: up } : { t: 'id', v: id[0] });
      i += id[0].length;
      continue;
    }
    throw new ReplayMiss('soqlQuery', `unparseable SOQL near "${q.slice(i, i + 20)}"`);
  }
  return out;
}

type Expr =
  | { k: 'and' | 'or'; a: Expr; b: Expr }
  | { k: 'not'; a: Expr }
  | { k: 'cmp'; field: string; op: string; value: unknown }
  | { k: 'in'; field: string; neg: boolean; values: unknown[] }
  | { k: 'like'; field: string; pattern: string };

export interface ParsedSoql {
  fields: string[];
  object: string;
  where?: Expr;
  orderBy: Array<{ field: string; dir: 1 | -1 }>;
  limit?: number;
}

export function parseSoql(q: string, now: Date): ParsedSoql {
  const toks = tokenize(q);
  let p = 0;
  const peek = () => toks[p];
  const next = () => toks[p++];
  const expectKw = (v: string) => {
    const t = next();
    if (t?.t !== 'kw' || t.v !== v) throw new ReplayMiss('soqlQuery', `expected ${v}`);
  };
  expectKw('SELECT');
  const fields: string[] = [];
  for (;;) {
    const t = next();
    if (t?.t !== 'id') throw new ReplayMiss('soqlQuery', 'unsupported SELECT item (aggregates/subqueries are not replayable)');
    fields.push(t.v);
    if (peek()?.t === 'comma') {
      p++;
      continue;
    }
    break;
  }
  expectKw('FROM');
  const obj = next();
  if (obj?.t !== 'id') throw new ReplayMiss('soqlQuery', 'missing FROM object');
  const literal = (t: Tok | undefined): unknown => {
    if (!t) throw new ReplayMiss('soqlQuery', 'missing literal');
    if (t.t === 'str') {
      if (t.v.startsWith('@dt:')) return { dt: Date.parse(t.v.slice(4)) };
      if (t.v.startsWith('@d:')) return { d: t.v.slice(3) };
      return t.v;
    }
    if (t.t === 'num') return Number(t.v);
    if (t.t === 'kw' && (t.v === 'TRUE' || t.v === 'FALSE')) return t.v === 'TRUE';
    if (t.t === 'kw' && t.v === 'NULL') return null;
    if (t.t === 'id') {
      const m = t.v.match(/^LAST_N_DAYS:(\d+)$/i);
      if (m) return { range: [now.getTime() - Number(m[1]) * 86400_000, now.getTime()] };
      if (/^TODAY$/i.test(t.v)) return { range: [startOfDayUtc(now), startOfDayUtc(now) + 86400_000] };
      if (/^YESTERDAY$/i.test(t.v)) return { range: [startOfDayUtc(now) - 86400_000, startOfDayUtc(now)] };
    }
    throw new ReplayMiss('soqlQuery', `unsupported literal ${t.v}`);
  };
  const primary = (): Expr => {
    const t = peek();
    if (t?.t === 'lp') {
      p++;
      const e = orExpr();
      if (next()?.t !== 'rp') throw new ReplayMiss('soqlQuery', 'missing )');
      return e;
    }
    if (t?.t === 'kw' && t.v === 'NOT') {
      p++;
      return { k: 'not', a: primary() };
    }
    const f = next();
    if (f?.t !== 'id') throw new ReplayMiss('soqlQuery', 'expected a field');
    const o = next();
    if (o?.t === 'op') return { k: 'cmp', field: f.v, op: o.v, value: literal(next()) };
    if (o?.t === 'kw' && o.v === 'LIKE') {
      const v = next();
      if (v?.t !== 'str') throw new ReplayMiss('soqlQuery', 'LIKE needs a string');
      return { k: 'like', field: f.v, pattern: v.v };
    }
    let neg = false;
    let o2 = o;
    if (o?.t === 'kw' && o.v === 'NOT') {
      neg = true;
      o2 = next();
    }
    if (o2?.t === 'kw' && o2.v === 'IN') {
      if (next()?.t !== 'lp') throw new ReplayMiss('soqlQuery', 'IN needs (');
      const values: unknown[] = [];
      while (peek() && peek()!.t !== 'rp') {
        if (peek()!.t === 'kw' && peek()!.v === 'SELECT') throw new ReplayMiss('soqlQuery', 'semi-join subqueries are not replayable');
        values.push(literal(next()));
        if (peek()?.t === 'comma') p++;
      }
      p++;
      return { k: 'in', field: f.v, neg, values };
    }
    throw new ReplayMiss('soqlQuery', `unsupported operator after ${f.v}`);
  };
  const andExpr = (): Expr => {
    let a = primary();
    while (peek()?.t === 'kw' && peek()!.v === 'AND') {
      p++;
      a = { k: 'and', a, b: primary() };
    }
    return a;
  };
  const orExpr = (): Expr => {
    let a = andExpr();
    while (peek()?.t === 'kw' && peek()!.v === 'OR') {
      p++;
      a = { k: 'or', a, b: andExpr() };
    }
    return a;
  };
  let where: Expr | undefined;
  if (peek()?.t === 'kw' && peek()!.v === 'WHERE') {
    p++;
    where = orExpr();
  }
  const orderBy: ParsedSoql['orderBy'] = [];
  if (peek()?.t === 'kw' && peek()!.v === 'ORDER') {
    p++;
    expectKw('BY');
    for (;;) {
      const f = next();
      if (f?.t !== 'id') throw new ReplayMiss('soqlQuery', 'ORDER BY needs a field');
      let dir: 1 | -1 = 1;
      if (peek()?.t === 'kw' && (peek()!.v === 'ASC' || peek()!.v === 'DESC')) dir = next()!.v === 'DESC' ? -1 : 1;
      if (peek()?.t === 'kw' && peek()!.v === 'NULLS') p += 2;
      orderBy.push({ field: f.v, dir });
      if (peek()?.t === 'comma') {
        p++;
        continue;
      }
      break;
    }
  }
  let limit: number | undefined;
  if (peek()?.t === 'kw' && peek()!.v === 'LIMIT') {
    p++;
    limit = Number(next()?.v);
  }
  if (p < toks.length) throw new ReplayMiss('soqlQuery', `unsupported trailing clause ${toks[p]!.v}`);
  return { fields, object: obj.v, where, orderBy, limit };
}

function startOfDayUtc(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Case-insensitive dotted path lookup (`Opportunity.Account.Name`). `undefined` = field not present in the row. */
export function getPath(row: Row, path: string): unknown {
  let cur: unknown = row;
  for (const part of path.split('.')) {
    if (cur === null) return null;
    if (typeof cur !== 'object') return undefined;
    const k = Object.keys(cur as object).find((x) => x.toLowerCase() === part.toLowerCase());
    if (k === undefined) return undefined;
    cur = (cur as Row)[k];
  }
  return cur;
}

export function hasPath(row: Row, path: string): boolean {
  let cur: unknown = row;
  for (const part of path.split('.')) {
    if (cur === null) return true; // a null parent satisfies any child path (SOQL returns null)
    if (typeof cur !== 'object') return false;
    const k = Object.keys(cur as object).find((x) => x.toLowerCase() === part.toLowerCase());
    if (k === undefined) return false;
    cur = (cur as Row)[k];
  }
  return true;
}

const asTime = (v: unknown): number | undefined => {
  if (typeof v !== 'string') return undefined;
  const t = Date.parse(v.replace(/\+0000$/, 'Z'));
  return Number.isNaN(t) ? undefined : t;
};

function cmp(a: unknown, b: unknown): number | undefined {
  if (a === null || a === undefined || b === null || b === undefined) return undefined;
  if (typeof b === 'object' && 'dt' in (b as object)) {
    const t = asTime(a);
    return t === undefined ? undefined : t - (b as { dt: number }).dt;
  }
  if (typeof b === 'object' && 'd' in (b as object)) {
    const s = String(a).slice(0, 10);
    const d = (b as { d: string }).d;
    return s < d ? -1 : s > d ? 1 : 0;
  }
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'boolean' || typeof b === 'boolean') return a === b ? 0 : 1;
  const x = String(a).toLowerCase();
  const y = String(b).toLowerCase();
  // 15- vs 18-char Salesforce ids compare on the 15-char prefix.
  if (/^[a-z0-9]{15}([a-z0-9]{3})?$/i.test(x) && /^[a-z0-9]{15}([a-z0-9]{3})?$/i.test(y) && (x.length !== y.length)) return x.slice(0, 15) === y.slice(0, 15) ? 0 : x < y ? -1 : 1;
  return x < y ? -1 : x > y ? 1 : 0;
}

export function evalExpr(e: Expr, row: Row): boolean {
  switch (e.k) {
    case 'and':
      return evalExpr(e.a, row) && evalExpr(e.b, row);
    case 'or':
      return evalExpr(e.a, row) || evalExpr(e.b, row);
    case 'not':
      return !evalExpr(e.a, row);
    case 'like': {
      const v = getPath(row, e.field);
      if (v === null || v === undefined) return false;
      const re = new RegExp(`^${e.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.')}$`, 'i');
      return re.test(String(v));
    }
    case 'in': {
      const v = getPath(row, e.field);
      const hit = e.values.some((x) => cmp(v, x) === 0);
      return e.neg ? !hit : hit;
    }
    case 'cmp': {
      const v = getPath(row, e.field);
      if (e.value && typeof e.value === 'object' && 'range' in (e.value as object)) {
        const [lo, hi] = (e.value as { range: [number, number] }).range;
        const t = asTime(v);
        if (t === undefined) return false;
        const inRange = t >= lo && t <= hi;
        return e.op === '=' ? inRange : e.op === '!=' ? !inRange : e.op === '<' ? t < lo : e.op === '<=' ? t <= hi : e.op === '>' ? t > hi : t >= lo;
      }
      if (e.value === null) return e.op === '=' ? v === null || v === undefined : v !== null && v !== undefined;
      const c = cmp(v, e.value);
      if (c === undefined) return e.op === '!=';
      return e.op === '=' ? c === 0 : e.op === '!=' ? c !== 0 : e.op === '<' ? c < 0 : e.op === '<=' ? c <= 0 : e.op === '>' ? c > 0 : c >= 0;
    }
  }
}

/** Fields an expression reads (so a row missing one is a harness miss, not a silent false). */
export function exprFields(e: Expr | undefined, out: string[] = []): string[] {
  if (!e) return out;
  switch (e.k) {
    case 'and':
    case 'or':
      exprFields(e.a, out);
      exprFields(e.b, out);
      break;
    case 'not':
      exprFields(e.a, out);
      break;
    default:
      out.push(e.field);
  }
  return out;
}

/** Project a row onto the SELECT list in REST shape (nested relationship objects with `attributes`). */
export function project(row: Row, fields: string[], object: string): Row {
  const out: Row = { attributes: { type: object } };
  for (const f of fields) {
    const parts = f.split('.');
    let src: unknown = row;
    let dst: Row = out;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      const k = src && typeof src === 'object' ? Object.keys(src as object).find((x) => x.toLowerCase() === part.toLowerCase()) ?? part : part;
      const v = src && typeof src === 'object' ? (src as Row)[k] : undefined;
      if (i === parts.length - 1) {
        dst[k] = v === undefined ? null : v;
      } else {
        if (v === null || v === undefined) {
          dst[k] = null;
          break;
        }
        const ex = dst[k];
        if (!ex || typeof ex !== 'object') dst[k] = { attributes: { type: k } };
        dst = dst[k] as Row;
        src = v;
      }
    }
  }
  return out;
}

export interface SoqlTable {
  object: string;
  rows: Row[];
  /** Field paths recorded for every row (a SELECT/WHERE outside this set is a miss). */
  fields: string[];
  /** Row visibility at simulated time: visible only when every listed timestamp ≤ now (values exist as of today only). */
  timeFields: string[];
}

export function runSoql(tables: Record<string, SoqlTable>, q: string, now: Date): { totalSize: number; done: boolean; records: Row[] } {
  const pq = parseSoql(q, now);
  const tab = Object.values(tables).find((t) => t.object.toLowerCase() === pq.object.toLowerCase());
  if (!tab) throw new ReplayMiss('soqlQuery', `object ${pq.object} not recorded`);
  const known = new Set(tab.fields.map((f) => f.toLowerCase()));
  for (const f of [...pq.fields, ...exprFields(pq.where), ...pq.orderBy.map((o) => o.field)]) {
    if (!known.has(f.toLowerCase())) throw new ReplayMiss('soqlQuery', `field ${pq.object}.${f} not recorded`);
  }
  const t = now.getTime();
  let rows = tab.rows.filter((r) =>
    tab.timeFields.every((f) => {
      const at = asTime(getPath(r, f));
      return at === undefined || at <= t;
    }),
  );
  if (pq.where) rows = rows.filter((r) => evalExpr(pq.where!, r));
  if (pq.orderBy.length) {
    rows = [...rows].sort((a, b) => {
      for (const o of pq.orderBy) {
        const c = cmp(getPath(a, o.field), getPath(b, o.field)) ?? 0;
        if (c) return c * o.dir;
      }
      return 0;
    });
  }
  const total = rows.length;
  if (pq.limit !== undefined) rows = rows.slice(0, pq.limit);
  return { totalSize: Math.min(total, pq.limit ?? total), done: true, records: rows.map((r) => project(r, pq.fields, tab.object)) };
}
