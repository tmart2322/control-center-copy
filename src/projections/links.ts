/**
 * Deep links back to the original (tenet: Provenance on everything). Pure; shared by ingest (the scanner store), the
 * projections and the read side, so every evidence chip, item origin, activity row, meeting, file and deal opens the
 * same URL for the same source.
 *
 *  - Org62: the Lightning record page, `<host>/lightning/r/<Object>/<Id>/view`, from the stored ids. The host is
 *    config (`CC_ORG62_HOST`, default the org62 Lightning host the account and opp `org62Url` always used).
 *  - Claude sessions: the Desktop continue link (`claude://code/continue?session=…`), the same one the Agents page
 *    uses. A link only: nothing here ever opens it.
 *  - Drive: the editor URL by file kind, else the Drive viewer.
 *  - Slack, Gmail, Calendar, Gemini notes: the fetchers and REC-1 store their own https permalinks; nothing to derive.
 */

export const DEFAULT_ORG62_HOST = 'https://org62.lightning.force.com';

/** The Org62 Lightning host (no trailing slash). `CC_ORG62_HOST` overrides it (a sandbox, another org). */
export function org62Host(): string {
  const v = (typeof process !== 'undefined' ? process.env.CC_ORG62_HOST : undefined)?.trim();
  return (v && /^https:\/\/[^/\s]+/.test(v) ? v : DEFAULT_ORG62_HOST).replace(/\/+$/, '');
}

/** A Salesforce record id (15 or 18 characters; placeholders in tests may sit in between). */
const SF_ID = /^[A-Za-z0-9]{15,18}$/;
const API_NAME = /^[A-Za-z][A-Za-z0-9_]{0,79}$/;

/** Key prefix → object, for rows whose sobject label is not an API name. */
const PREFIX_OBJECT: Record<string, string> = { '001': 'Account', '003': 'Contact', '005': 'User', '006': 'Opportunity', '00U': 'Event', '00T': 'Task', '00Q': 'Lead', '500': 'Case' };

/**
 * The scan-org62 skill's pseudo objects (`Book:<OppId>`, `BookDc:<DcId>`, `MissedOpp:<OppId>`, team rows keyed by the
 * opp id) → the record they stand for. `BookRun:<run>` is a manifest of a read, not a record: no link.
 */
const PSEUDO_OBJECT: Record<string, string | null> = {
  Book: 'Opportunity',
  MissedOpp: 'Opportunity',
  OpportunityTeamMember: 'Opportunity',
  BookDc: 'Deal_Contribution__c',
  DealContribution: 'Deal_Contribution__c',
  DC: 'Deal_Contribution__c',
  BookRun: null,
};

/** `<host>/lightning/r/<Object>/<Id>/view`; the object from the key prefix when it is not given. */
export function org62RecordUrl(sobject: string | null | undefined, id: string): string | null {
  const rid = (id ?? '').trim();
  if (!SF_ID.test(rid)) return null;
  const obj = sobject && API_NAME.test(sobject) ? sobject : PREFIX_OBJECT[rid.slice(0, 3)];
  // Any record id resolves from the classic path, which Lightning redirects to the record page.
  return obj ? `${org62Host()}/lightning/r/${obj}/${rid}/view` : `${org62Host()}/${rid}`;
}

/** An Org62 source item's externalId (`<Sobject>:<Id>@<SystemModstamp>`) → its record page, or null. */
export function org62LinkOf(externalId: string, meta: Record<string, unknown> = {}): string | null {
  const i = externalId.indexOf(':');
  if (i <= 0) return null;
  const label = externalId.slice(0, i);
  const rest = externalId.slice(i + 1);
  const at = rest.indexOf('@');
  let id = (at >= 0 ? rest.slice(0, at) : rest).trim();
  const mapped = label in PSEUDO_OBJECT ? PSEUDO_OBJECT[label] : label;
  if (mapped === null) return null;
  if (!SF_ID.test(id)) {
    // A row keyed by something else (a sweep, a run): the opp it names, when it names one.
    const hint = (Array.isArray(meta.oppHints) ? meta.oppHints : []).find((h): h is string => typeof h === 'string' && SF_ID.test(h) && h.startsWith('006'));
    if (!hint) return null;
    return org62RecordUrl('Opportunity', hint);
  }
  if (mapped === 'Opportunity' && !id.startsWith('006')) {
    const hint = (Array.isArray(meta.oppHints) ? meta.oppHints : []).find((h): h is string => typeof h === 'string' && SF_ID.test(h) && h.startsWith('006'));
    if (hint) id = hint;
  }
  return org62RecordUrl(mapped, id);
}

/** The Desktop continue link of a Claude session: the host (`local_…`) id when known, else the CLI session id. */
export function claudeSessionLink(sessionId: string, hostSessionId?: string | null): string {
  return `claude://code/continue?session=${hostSessionId || sessionId}`;
}

/** A Drive file's editor URL by kind (`deck`/`slides`, `doc`, `sheet`), else the viewer. */
export function driveFileLink(fileId: string, kind?: string | null): string {
  const k = (kind ?? '').toLowerCase();
  if (k === 'deck' || k === 'slides' || k === 'presentation') return `https://docs.google.com/presentation/d/${fileId}/edit`;
  if (k === 'doc' || k === 'document') return `https://docs.google.com/document/d/${fileId}/edit`;
  if (k === 'sheet' || k === 'spreadsheet') return `https://docs.google.com/spreadsheets/d/${fileId}/edit`;
  return `https://drive.google.com/file/d/${fileId}/view`;
}

/** A Slack message's archive link from its channel and ts, when the workspace host is known (`CC_SLACK_HOST`). */
export function slackArchiveLink(channelId: string, ts: string): string | null {
  const host = (typeof process !== 'undefined' ? process.env.CC_SLACK_HOST : undefined)?.trim();
  if (!host || !/^https:\/\/[^/\s]+/.test(host) || !/^[CDG][A-Z0-9]+$/.test(channelId) || !/^\d+\.\d+$/.test(ts)) return null;
  return `${host.replace(/\/+$/, '')}/archives/${channelId}/p${ts.replace('.', '')}`;
}

export interface LinkableSource {
  /** source_system: slack | gmail | calendar | drive | gemini_notes | org62 | claude | vdp | manual … */
  source: string;
  externalId: string;
  url?: string | null;
  meta?: Record<string, unknown> | null;
}

const s = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** The stored URL, else the one derived from the stored ids (null when the source has no addressable original). */
export function sourceItemUrl(si: LinkableSource): string | null {
  if (si.url) return si.url;
  const m = si.meta ?? {};
  switch (si.source) {
    case 'org62':
      return org62LinkOf(si.externalId, m);
    case 'claude': {
      const id = s(m.sessionId) ?? si.externalId;
      return id && !id.startsWith('evidence:') ? claudeSessionLink(id, s(m.hostSessionId)) : null;
    }
    case 'drive': {
      const fileId = s(m.fileId) ?? si.externalId.split('@')[0] ?? null;
      return fileId && /^[A-Za-z0-9_-]{15,}$/.test(fileId) ? driveFileLink(fileId, s(m.fileKind) ?? s(m.kind)) : null;
    }
    case 'gemini_notes': {
      const docId = s(m.docId) ?? si.externalId;
      return docId && /^[A-Za-z0-9_-]{15,}$/.test(docId) ? `https://docs.google.com/document/d/${docId}/edit` : null;
    }
    case 'calendar':
      return s(m.htmlLink) ?? s(m.link);
    case 'gmail':
      return s(m.webLink);
    case 'slack': {
      const p = s(m.permalink);
      if (p) return p;
      const [channel, ts] = si.externalId.split(':');
      return channel && ts ? slackArchiveLink(channel, ts) : null;
    }
    default:
      return null;
  }
}
