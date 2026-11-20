/**
 * Post-pass: facts that only exist once every domain has run. Connector error stamps come from the scan runs
 * domain 03 wrote (a connector's last_error_at / last_error_code is its latest failed run), and two status_changed_at
 * values follow the auth events in domain 03.
 */
import { readTable, writeTable, type Row } from '../lib/kit';

const connectors = readTable('connectors');
const runs = readTable('scan_runs');
const fixed: Record<string, string> = { drive: '2026-11-14T21:58:48.000Z', vdp: '2026-11-18T15:30:00.000Z' };

const out = connectors.map((c: Row) => {
  const failed = runs
    .filter((r) => r.connector_id === c.id && r.status === 'failed' && r.finished_at && r.error_code)
    .sort((a, b) => String(b.finished_at).localeCompare(String(a.finished_at)))[0];
  const next: Row = { ...c };
  if (failed && (!c.last_error_at || String(failed.finished_at) > String(c.last_error_at))) {
    next.last_error_at = failed.finished_at;
    next.last_error_code = failed.error_code;
  }
  if (fixed[String(c.kind)]) next.status_changed_at = fixed[String(c.kind)];
  return next;
});
writeTable('connectors', out);
