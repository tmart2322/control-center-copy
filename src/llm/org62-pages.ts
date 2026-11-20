/**
 * ORG-3: what the Org62 read tool actually returned in a run, so a window the agent called incomplete can be judged
 * by the skill's own paging rule. scan-org62 pages a windowed query only when it returns its LIMIT; a run whose every
 * SOQL query came back under its LIMIT, with no error, has read the whole window.
 *
 * On the first ramp stage the agent finished three quiet `opps` windows (0–6 rows) with `complete: false` and its
 * cursor at the window start. The store then clamped their coverage to nothing, so those weeks were holes, and the
 * stalled-continuation retry kept the scope pending for another 30 minutes. The runner now corrects such a finish to
 * complete, but only when the agent's own coverage reaches the window end.
 */
import { bareToolName } from './slack-rec';

/** The tool response as text (MCP content blocks, a plain string, or an object). */
export function toolResponseText(r: unknown): string {
  if (typeof r === 'string') return r;
  if (Array.isArray(r)) return r.map((b) => (b && typeof b === 'object' && 'text' in b ? String((b as { text: unknown }).text) : typeof b === 'string' ? b : '')).join('\n');
  if (r && typeof r === 'object') {
    const c = (r as { content?: unknown }).content;
    if (Array.isArray(c)) return toolResponseText(c);
    return JSON.stringify(r);
  }
  return '';
}

/** Rows a SOQL result holds (`records` of the JSON; a count of record attributes when the text is not plain JSON). */
export function soqlRowCount(text: string): number | undefined {
  try {
    const j = JSON.parse(text) as { records?: unknown[] };
    if (Array.isArray(j.records)) return j.records.length;
  } catch {
    /* fall through */
  }
  const m = text.match(/"attributes"\s*:/g);
  return m ? m.length : /"records"\s*:\s*\[\s*\]/.test(text) ? 0 : undefined;
}

/** The result's own `done` flag (false: Salesforce holds more rows behind `nextRecordsUrl`). */
export function soqlDone(text: string): boolean | undefined {
  const m = /"done"\s*:\s*(true|false)/.exec(text);
  return m ? m[1] === 'true' : undefined;
}

export class Org62PageObserver {
  queries = 0;
  /** A query returned its LIMIT (the agent had to page), or a result could not be read. */
  paged = false;
  errored = false;

  onToolResult(toolName: string, toolInput: unknown, toolResponse: unknown): void {
    if (bareToolName(toolName) !== 'soqlQuery') return;
    this.queries += 1;
    const q = String((toolInput as { q?: unknown } | undefined)?.q ?? '');
    const limit = Number(/\bLIMIT\s+(\d+)/i.exec(q)?.[1] ?? NaN);
    const text = toolResponseText(toolResponse);
    if (/"errorCode"\s*:|MALFORMED_QUERY|INVALID_FIELD|INVALID_TYPE/i.test(text)) {
      this.errored = true;
      return;
    }
    const rows = soqlRowCount(text);
    // With a LIMIT, a full page may hide more rows (the skill pages). Without one (an extra paging query the agent
    // wrote, ORG-3b), the result's own `done` says whether Salesforce holds more.
    if (rows === undefined) this.paged = true;
    else if (Number.isFinite(limit)) {
      if (rows >= limit) this.paged = true;
    } else if (soqlDone(text) !== true) this.paged = true;
  }

  /** Every query ran under its LIMIT, without an error: the window was read whole. */
  readWhole(): boolean {
    return this.queries > 0 && !this.paged && !this.errored;
  }
}
