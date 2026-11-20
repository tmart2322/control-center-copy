/**
 * Audit trail for what 92 added (optional item: audit_events back toward ~1,500, honestly):
 *  - every appended Org62 snapshot (si-752..) is an insert by the Org62 scan change set of the run that first saw it
 *  - every transition added by realism-work is a work_items status update by the engine / user change set nearest in time
 * Timestamps of the snapshot rows follow the change set so audit, change set and row agree.
 */
import { rng } from '../../lib/kit';
import { ms, plus, readTable, writeTable, type Row } from './realism-lib';
import { NEW_SI_FROM } from './realism-sources';

export function audit() {
  const R = rng('realism-audit');
  const items = readTable('source_items'); const cs = readTable('change_sets'); let au = readTable('audit_events'); const runs = new Map(readTable('scan_runs').map((r) => [String(r.id), r]));
  let nextId = au.reduce((m, a) => Math.max(m, Number(a.id)), 0);
  const o62cs = cs.filter((c) => String(c.actor_ref).startsWith('scan:org62:') && /new,|updated/.test(String(c.summary)));
  const fresh = items.filter((s) => s.kind === 'org62_record_snapshot' && Number(String(s.external_id).length) > 0 && s.created_at !== null);
  const newIds = new Set<string>(); // identify the appended rows by their position at the end of the table
  for (let i = items.length - 1; i >= 0 && newIds.size < items.length - 751; i--) newIds.add(String(items[i]!.id));
  void NEW_SI_FROM; void fresh;
  const out: Row[] = []; let n = 0;
  for (const s of items) {
    if (!newIds.has(String(s.id))) continue;
    const run = runs.get(String(s.first_scan_run_id))!; const lo = ms(run.started_at) - 60_000; const hi = ms(run.finished_at) + 120_000;
    const scope = String(run.scope).split(':')[1];
    const set = o62cs.filter((c) => ms(c.created_at) >= lo && ms(c.created_at) <= hi && String(c.actor_ref).includes(`:${scope}@`)).sort((a, b) => ms(a.created_at) - ms(b.created_at))[(n++) % 3] ?? o62cs.filter((c) => ms(c.created_at) >= lo && ms(c.created_at) <= hi)[0];
    if (!set) continue;
    const t = plus(set.created_at, R.int(0, 600) / 1000); s.first_seen_at = t; s.created_at = t; if (ms(s.updated_at) < ms(t)) s.updated_at = t;
    const after = { id: s.id, owner_user_id: s.owner_user_id, connector_id: s.connector_id, source: s.source, kind: s.kind, external_id: s.external_id, dedupe_key: s.dedupe_key, occurred_at: s.occurred_at, title: s.title, first_seen_at: t, created_at: t, updated_at: s.updated_at };
    nextId++;
    out.push({ id: nextId, owner_user_id: s.owner_user_id, change_set_id: set.id, actor_kind: 'connector', actor_ref: set.actor_ref, table_name: 'source_items', row_id: s.id, entity_type: 'source_item', entity_id: s.id, op: 'insert', changed_fields: Object.keys(after).sort(), before: null, after, coalesced_count: 1, destination: null, payload_hash: null, created_at: t, updated_at: t });
  }
  writeTable('source_items', items);
  // transitions added by realism-work: id, time and the engine change set nearest before it
  const trans = readTable('work_item_transitions'); const wi = new Map(readTable('work_items').map((w) => [String(w.id), w]));
  const usedCs = new Set(au.map((a) => `${a.change_set_id}|${a.row_id}`));
  const known = new Set(au.filter((a) => a.table_name === 'work_items').map((a) => `${a.row_id}|${String(a.created_at).slice(0, 16)}`));
  const engine = cs.filter((c) => c.kind === 'engine_pass').sort((a, b) => ms(a.created_at) - ms(b.created_at));
  const user = cs.filter((c) => c.kind === 'user_edit' && String(c.actor_ref) === 'ui.edit').sort((a, b) => ms(a.created_at) - ms(b.created_at));
  for (const t of trans) {
    if (t.from_status == null || known.has(`${t.work_item_id}|${String(t.occurred_at).slice(0, 16)}`)) continue;
    if (!['likely_done', 'waiting_on_others'].includes(String(t.to_status)) && !['likely_done', 'waiting_on_others'].includes(String(t.from_status)) && !(t.from_status === 'done')) continue;
    const pool = t.actor_kind === 'user' ? user : engine; let set: Row | undefined; for (const c of pool) if (ms(c.created_at) <= ms(t.occurred_at) && !usedCs.has(`${c.id}|${t.work_item_id}`)) set = c;
    if (!set) continue; usedCs.add(`${set.id}|${t.work_item_id}`); const w = wi.get(String(t.work_item_id))!;
    nextId++;
    out.push({ id: nextId, owner_user_id: w.owner_user_id, change_set_id: set.id, actor_kind: t.actor_kind === 'user' ? 'user' : 'engine', actor_ref: t.actor_ref, table_name: 'work_items', row_id: w.id, entity_type: 'work_item', entity_id: w.id, op: 'update', changed_fields: ['status', 'status_changed_at', 'updated_at'], before: { id: w.id, status: t.from_status }, after: { id: w.id, status: t.to_status, status_changed_at: t.occurred_at, updated_at: t.occurred_at }, coalesced_count: 1, destination: null, payload_hash: null, created_at: t.occurred_at, updated_at: t.occurred_at });
  }
  au = [...au, ...out].sort((a, b) => ms(a.created_at) - ms(b.created_at) || Number(a.id) - Number(b.id));
  au.forEach((a, i) => { a.id = i + 1; });
  writeTable('audit_events', au);
}
