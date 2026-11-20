/**
 * Time ▸ VDP ▸ Changes, the tree (D-63, pure): Company → VDP → items, as rows, and the selection rules. The server
 * builds the tree and decides every item (src/engines/vdp/tree.ts); these only shape it and tick it.
 *
 *   rows        company · VDP · section · item · child (a Generate under its use case), in display order. Each item row
 *               says whether it can be pushed now: an Apply VDP's MCP takes (else `disabled`, with the reason), open,
 *               every value it needs typed or suggested, and every item above it pushable too (or applied already)
 *   tick        a node ticks its pushable descendants; a child of a company or VDP that does not exist yet ticks those
 *               ancestors; unticking anything unticks what needs it (an unborn parent's whole subtree)
 *   push        the ticked rows with what was typed in them (and their suggestions); the server adds anything still
 *               needed first and runs them in order (company → VDP → header → people → opportunities → use cases →
 *               Generate → assets)
 */
import type { VdpApply, VdpAssetItem, VdpCompanyIdentity, VdpPushNode, VdpPushRun, VdpSection, VdpStep, VdpSuggestion, VdpTreeCompany, VdpTreeLeaf } from '@/contract';
import { pushRankOf } from '@/engines/vdp/tree';

export type TreeRowKind = 'company' | 'vdp' | 'section' | 'item' | 'child';

export interface TreeRow {
  /** Unique per row (the panel ref for an item; `company:<key>` / `vdp:<key>` / `section:<vdp>:<kind>`). */
  id: string;
  kind: TreeRowKind;
  /** 0 company · 1 VDP · 2 section and item · 3 child */
  level: 0 | 1 | 2 | 3;
  title: string;
  /** The details key it opens (VDP slug or `account:<id>`) and its panel ref. */
  detailsKey: string;
  ref: string | null;
  /** The Apply key, when the row is an item the app can send. */
  key: string | null;
  step: VdpStep | null;
  asset: VdpAssetItem | null;
  section: VdpSection | null;
  /** The items (keys) that must be applied first. */
  requires: string[];
  /** Every item key under this row (company, VDP, an item with children). */
  descendants: string[];
  /** Shown, not pushable: why (VDP's MCP can't take it yet, a parent that can't be pushed). */
  disabled: string | null;
  /** The VDP row: what to show (its status, its link to view it). */
  vdp: { label: string; exists: boolean; url: string | null; status: VdpTreeCompany['vdps'][number]['status']; opportunities: string[] } | null;
  /** How the latest push left it (failed / skipped, with why). */
  push: VdpPushNode | null;
  /** D-69: the company row's identity (which VDP company, how decided, Change…). */
  identity?: VdpCompanyIdentity | null;
}

type Values = Readonly<Record<string, Readonly<Record<string, string>>>>;

/** A push still "running" after this long is not followed any more (the worker was down; its items stay staged). */
export const PUSH_STALE_MS = 30 * 60_000;

const hasVal = (v: unknown) => v !== null && v !== undefined && !(typeof v === 'string' && v.trim() === '') && !(Array.isArray(v) && !v.length);
const asText = (v: unknown): string => (v === null || v === undefined ? '' : Array.isArray(v) ? v.join(', ') : String(v));

/** The values an Apply would send now: what you typed, else the suggestion, else the app's own value. */
export function applyValues(apply: Pick<VdpApply, 'fields'>, typed: Readonly<Record<string, string>> | undefined, suggestion: VdpSuggestion | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of apply.fields) {
    const own = typed?.[f.field];
    out[f.field] = f.fixed ? asText(f.suggested) : own !== undefined && own.trim() !== '' ? own : (suggestion?.values[f.field] ?? asText(f.suggested));
  }
  return out;
}

/** Every value its call needs is there (typed, suggested or the app's own). A Generate needs none. */
export function applyFilled(apply: Pick<VdpApply, 'fields' | 'op'>, typed: Readonly<Record<string, string>> | undefined, suggestion: VdpSuggestion | null | undefined): boolean {
  if (apply.op === 'generate_use_case') return true;
  const v = applyValues(apply, typed, suggestion);
  return apply.fields.every((f) => !f.required || hasVal(v[f.field])) && apply.fields.some((f) => f.field !== 'track' && hasVal(v[f.field]));
}

/** An item needs typing before it can go (an input with no value: use-case inputs, an AE no forecast names, the entitlement). */
export const needsInput = (apply: Pick<VdpApply, 'fields' | 'op'>, suggestion: VdpSuggestion | null | undefined): boolean => !applyFilled(apply, undefined, suggestion);

const applyOf = (r: Pick<TreeRow, 'step' | 'asset'>) => r.step?.apply ?? r.asset?.apply ?? null;
const stateOf = (r: Pick<TreeRow, 'step' | 'asset'>) => r.step?.state ?? r.asset?.state ?? 'todo';
const suggestionOf = (r: Pick<TreeRow, 'step'>) => r.step?.suggestion ?? null;

/** Can this one row go as it is (its own Apply, state and values; not its ancestors)? */
export function ownReady(r: Pick<TreeRow, 'step' | 'asset' | 'key' | 'disabled'>, values: Values): boolean {
  const a = applyOf(r);
  if (!a || !r.key || r.disabled) return false;
  const st = stateOf(r);
  if (st === 'staged') return true;
  // D-69 (VD-23): a create that may be in VDP already goes again only through a push, which looks first
  if (st !== 'todo' && st !== 'maybe_made') return false;
  return applyFilled(a, values[r.key], suggestionOf(r));
}

/** The tree as rows, in display order, with each item's ancestors, descendants and why it can't be pushed. */
export function treeRows(tree: readonly VdpTreeCompany[], push: VdpPushRun | null = null): TreeRow[] {
  const rows: TreeRow[] = [];
  const pushed = new Map((push?.nodes ?? []).map((n) => [n.key, n]));
  const leafRow = (l: VdpTreeLeaf, kind: TreeRowKind, level: TreeRow['level'], detailsKey: string, descendants: string[] = []): TreeRow => {
    const s = l.step;
    const a = l.asset;
    // only an item with a call can be disabled (Find assets and the assets to confirm have their own verb)
    const disabled = s?.apply || a?.apply ? (s?.disabled ?? a?.disabled ?? null) : a && !a.apply ? (a.disabled ?? null) : null;
    return { id: l.ref, kind, level, title: l.title, detailsKey, ref: l.ref, key: l.key, step: s, asset: a, section: s?.section ?? (a ? 'assets' : null), requires: s?.requires ?? a?.requires ?? [], descendants, disabled, vdp: null, push: l.key ? (pushed.get(l.key) ?? null) : null };
  };
  for (const c of tree) {
    const keysUnder = c.vdps.flatMap((v) => [v.node?.key, ...v.sections.flatMap((s) => s.items.flatMap((i) => [i.key, ...i.children.map((x) => x.key)]))]).filter((k): k is string => !!k);
    const detailsKey = c.vdps[0]?.key ?? c.key;
    if (c.node) rows.push({ ...leafRow(c.node, 'company', 0, detailsKey, keysUnder), title: c.node.title, identity: c.identity ?? null });
    else rows.push({ id: `company:${c.key}`, kind: 'company', level: 0, title: c.companyName, detailsKey, ref: null, key: null, step: null, asset: null, section: null, requires: [], descendants: keysUnder, disabled: null, vdp: null, push: null, identity: c.identity ?? null });
    for (const v of c.vdps) {
      const under = v.sections.flatMap((s) => s.items.flatMap((i) => [i.key, ...i.children.map((x) => x.key)])).filter((k): k is string => !!k);
      const info = { label: v.label, exists: v.exists, url: v.url, status: v.status, opportunities: v.opportunities };
      if (v.node) rows.push({ ...leafRow(v.node, 'vdp', 1, v.key, under), vdp: info });
      else rows.push({ id: `vdp:${v.key}`, kind: 'vdp', level: 1, title: v.label, detailsKey: v.key, ref: null, key: null, step: null, asset: null, section: null, requires: [], descendants: under, disabled: null, vdp: info, push: null });
      for (const s of v.sections) {
        rows.push({ id: `section:${v.key}:${s.kind}`, kind: 'section', level: 2, title: s.title, detailsKey: v.key, ref: null, key: null, step: null, asset: null, section: s.kind, requires: [], descendants: s.items.flatMap((i) => [i.key, ...i.children.map((x) => x.key)]).filter((k): k is string => !!k), disabled: null, vdp: null, push: null });
        for (const it of s.items) {
          rows.push(leafRow(it, 'item', 2, v.key, it.children.map((x) => x.key).filter((k): k is string => !!k)));
          for (const ch of it.children) rows.push(leafRow(ch, 'child', 3, v.key));
        }
      }
    }
  }
  // an item whose parent can't be pushed can't be either: say which (once VDP's MCP lists the parent's tool, both go)
  const byKey = new Map(rows.filter((r) => r.key).map((r) => [r.key!, r]));
  for (const r of rows) {
    if (r.disabled || !r.key) continue;
    const blocked = r.requires.map((k) => byKey.get(k)).find((p) => p?.disabled && (p.step?.state ?? 'todo') !== 'waiting');
    if (blocked) r.disabled = `Needs “${blocked.title}” first: ${blocked.disabled}`;
  }
  return rows;
}

/** The rows by key (items only). */
const index = (rows: readonly TreeRow[]) => new Map(rows.filter((r) => r.key).map((r) => [r.key!, r]));

/** Can it be pushed now: its own row, and every item it needs first either pushable too or applied already. */
export function canPush(r: TreeRow, rows: readonly TreeRow[], values: Values, idx = index(rows)): boolean {
  if (!ownReady(r, values)) return false;
  return r.requires.every((k) => {
    const p = idx.get(k);
    if (!p) return true; // applied and read: not in the tree any more
    const st = stateOf(p);
    return st === 'waiting' || ownReady(p, values);
  });
}

/** Why it can't be pushed (for its title and the disabled checkbox), or null when it can. */
export function whyNot(r: TreeRow, rows: readonly TreeRow[], values: Values): string | null {
  if (!r.key || canPush(r, rows, values)) return null;
  if (r.disabled) return r.disabled;
  const st = stateOf(r);
  if (st === 'waiting') return 'Applied: waiting for VDP to refresh';
  const idx = index(rows);
  const parent = r.requires.map((k) => idx.get(k)).find((p) => p && stateOf(p) !== 'waiting' && !ownReady(p, values));
  if (parent && ownReady(r, values)) return `Fill in “${parent.title}” first`;
  return 'Fill it in first';
}

/** Every row that can be pushed now (select-all; a disabled or unfilled one is skipped). */
export function pushableKeys(rows: readonly TreeRow[], values: Values): string[] {
  const idx = index(rows);
  return rows.filter((r) => r.key && canPush(r, rows, values, idx)).map((r) => r.key!);
}

/**
 * Tick or untick a row (D-63 rules):
 *   tick a node (company, VDP, an item with children)   it and its pushable descendants
 *   tick a child of a company / VDP that does not exist  its ancestors too (they are pushed first anyway)
 *   untick                                               it and everything that needs it (an unborn parent's subtree)
 */
export function toggleRow(ticked: ReadonlySet<string>, row: TreeRow, rows: readonly TreeRow[], values: Values): Set<string> {
  const idx = index(rows);
  const ok = (k: string) => {
    const r = idx.get(k);
    return !!r && canPush(r, rows, values, idx);
  };
  const own = row.key && ok(row.key) ? [row.key] : [];
  const group = [...own, ...row.descendants.filter(ok)];
  const on = group.length > 0 && group.every((k) => ticked.has(k));
  const next = new Set(ticked);
  if (!on) {
    for (const k of group) {
      next.add(k);
      for (const a of idx.get(k)?.requires ?? []) if (ok(a)) next.add(a);
    }
    return next;
  }
  // untick: the group, then everything that needs something unticked (repeat until it settles)
  const off = new Set(group);
  let grew = true;
  while (grew) {
    grew = false;
    for (const r of rows) if (r.key && !off.has(r.key) && r.requires.some((a) => off.has(a))) {
      off.add(r.key);
      grew = true;
    }
  }
  for (const k of off) next.delete(k);
  return next;
}

/** A node's tick state: all, some or none of its pushable rows ticked (for the checkbox's mixed state). */
export function tickState(row: TreeRow, ticked: ReadonlySet<string>, rows: readonly TreeRow[], values: Values): 'all' | 'some' | 'none' | 'off' {
  const idx = index(rows);
  const group = [...(row.key ? [row.key] : []), ...row.descendants].filter((k) => {
    const r = idx.get(k);
    return !!r && canPush(r, rows, values, idx);
  });
  if (!group.length) return 'off';
  const n = group.filter((k) => ticked.has(k)).length;
  return n === 0 ? 'none' : n === group.length ? 'all' : 'some';
}

/** The ticked rows (still pushable) and the ones they need first, in push order (what the confirm lists). */
export function pushOrder(ticked: ReadonlySet<string>, rows: readonly TreeRow[], values: Values): Array<{ row: TreeRow; required: boolean }> {
  const idx = index(rows);
  const keys = new Set([...ticked].filter((k) => {
    const r = idx.get(k);
    return !!r && canPush(r, rows, values, idx);
  }));
  const out = new Map<string, boolean>();
  for (const k of keys) {
    for (const a of idx.get(k)!.requires) {
      const p = idx.get(a);
      if (p && stateOf(p) !== 'waiting' && !keys.has(a)) out.set(a, true);
    }
    out.set(k, false);
  }
  const rank = (r: TreeRow) => pushRankOf({ op: applyOf(r)?.op ?? '', section: r.section });
  const pos = new Map(rows.map((r, i) => [r.id, i]));
  return [...out]
    .map(([k, required]) => ({ row: idx.get(k)!, required }))
    .filter((x) => !!x.row)
    .sort((a, b) => rank(a.row) - rank(b.row) || (pos.get(a.row.id) ?? 0) - (pos.get(b.row.id) ?? 0));
}

/** The push request's items: each ticked row with what you typed (its suggestions too, when it has some). */
export function pushRequest(ticked: ReadonlySet<string>, rows: readonly TreeRow[], values: Values): Array<{ itemKey: string; values?: Record<string, string>; useSuggestion?: boolean }> {
  return pushOrder(ticked, rows, values)
    .filter((x) => !x.required || x.row.key)
    .map(({ row }) => {
      const typed = values[row.key!];
      const own = typed ? Object.fromEntries(Object.entries(typed).filter(([, v]) => v.trim() !== '')) : {};
      return { itemKey: row.key!, ...(Object.keys(own).length ? { values: own } : {}), ...(row.step?.suggestion ? { useSuggestion: true } : {}) };
    });
}

/** One row's own Apply: it, plus what it needs first (the label says so: "Apply · creates 2 first"). */
export function applyLabel(row: TreeRow, rows: readonly TreeRow[]): { label: string; above: TreeRow[] } {
  const idx = index(rows);
  const above = row.requires.map((k) => idx.get(k)).filter((p): p is TreeRow => !!p && stateOf(p) !== 'waiting');
  return { label: above.length ? `Apply · ${above.length} first` : 'Apply', above };
}

/**
 * "Pushing to VDP: 3 of 7 done" while a push runs (an item counts once it ended, or its Outbox item is applied);
 * null when none is running.
 */
export function pushProgress(run: VdpPushRun | null, rows: readonly TreeRow[] = [], nowMs?: number): string | null {
  if (!run || run.state === 'done' || run.state === 'stopped') return null;
  // a push the worker never picked up (it was down) does not hold the page: after 30 minutes it reads as over
  if (nowMs !== undefined && nowMs - Date.parse(run.at) > PUSH_STALE_MS) return null;
  const idx = index(rows);
  const done = run.nodes.filter((n) => n.state === 'applied' || n.state === 'dry_run' || n.state === 'failed' || n.state === 'skipped' || (idx.get(n.key) && stateOf(idx.get(n.key)!) === 'waiting')).length;
  return `Pushing to VDP: ${done} of ${run.nodes.length} done`;
}
