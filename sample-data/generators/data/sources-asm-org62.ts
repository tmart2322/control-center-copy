/** Domain 02 assembly: Org62 events and opportunity snapshots, VDP records and candidates, Claude session items. */
import { OWNER, ref, rng, sfId } from '../../lib/kit';
import { ACCOUNTS, OPPS } from './core-deals';
import { ALL_ASSETS } from './sources-asm-drive';
import { CANDIDATES, CLAUDE_SESSIONS, DC_ITEMS, ORG62_EVENTS, OPP_HISTORY, OPP_NEXT, OPP_PRODUCTS, TEAM_ITEMS, VDPS } from './sources-org62';
import { KIND_OF } from './sources-drive';
import { ACCT_SF, NAME, OPP_BY_KEY, OPP_SF, P, T_SCAN_END, T_START, aid, addItem, addMinutes, at, fid, furl, ITEMS, oid, pid, sha, uid, type Item } from './sources-lib';
import { readTable } from '../../lib/kit';

type Row = Record<string, unknown>;
const oppRows = Object.fromEntries(readTable('opportunities').map((r) => [r.id as string, r]));
const acctName = (k: string) => ACCOUNTS.find((a) => a.key === k)!.name;
const aeOf = (acct: string) => ACCOUNTS.find((a) => a.key === acct)!.ae;
const oppName = (k: string) => OPPS.find((o) => o.key === k)!.name;

// ───────────────────────── Org62 events ─────────────────────────
export const o62Key = (n: number) => `o62-${String(n).padStart(2, '0')}`;
const o62Id = (n: number) => sfId('00U', n);
const stampOf = (e: (typeof ORG62_EVENTS)[number]) => (e.modified ? at(e.modified.d, e.modified.t + ':00') : at(e.logged.d, e.logged.t + ':00'));
export function assembleOrg62(): void {
  for (const e of ORG62_EVENTS) {
    const start = at(e.d, e.t + ':00');
    const end = addMinutes(start, e.mins);
    const created = at(e.logged.d, e.logged.t + ':00');
    const stamp = stampOf(e);
    const r = rng(`o62:${e.n}`);
    const firstSeen = addMinutes(stamp, r.int(15, 60));
    const del = e.deleted ? at(e.deleted.d, e.deleted.t + ':00') : null;
    const ccKey = e.cc ? ref('activity_entries', `act-${o62Key(e.n)}`, 'activity entry whose canvas row landed this Org62 event (source item meta.ccKey); status logged or verified (the deleted-in-Org62 one is act-o62-22)') : null;
    const meta: Record<string, unknown> = {
      connector: 'org62', itemKind: 'record_snapshot', rec: 'auto',
      StartDateTime: start, EndDateTime: end, DurationInMinutes: e.mins, Duration__c: e.hours, SE_Task_Type__c: e.task, Meeting_Type__c: e.meeting,
      RecordTypeName: 'Solutions Event', WhatId: e.opp ? OPP_SF(e.opp) : null, WhatName: e.opp ? oppName(e.opp) : null, WhatType: e.opp ? 'Opportunity' : null,
      AccountId: e.acct ? ACCT_SF(e.acct) : null, CreatedDate: created, ...(ccKey ? { ccKey } : {}),
      ...(e.opp ? { oppHints: [OPP_SF(e.opp)] } : {}), ...(e.acct ? { accountHints: [ACCT_SF(e.acct)] } : {}),
    };
    addItem({
      tag: `o62-ev-${e.n}`, source: 'org62', kind: 'org62_record_snapshot', connector: 'org62', ext: `Event:${o62Id(e.n)}@${stamp}`, parent: o62Id(e.n), container: 'Event',
      dedupe: `org62:Event:${o62Id(e.n)}@${stamp}`, occurred: stamp, srcUpdated: stamp, firstSeen, lastSeen: del ? addMinutes(del, -r.int(60, 600)) : addMinutes(T_SCAN_END, -r.int(0, 400)),
      actor: 'owner', actorExt: '005SMPL00000001AAA', fromMe: true, title: e.subject, url: `https://org62.example.com/lightning/r/Event/${o62Id(e.n)}/view`,
      body: `type=${e.task ?? ''}; meeting_type=${e.meeting ?? ''}; rt=Solutions Event; hrs=${e.hours ?? ''}; what=${e.opp ? oppName(e.opp) : ''}`.replace(/\s+/g, ' '),
      meta, acct: e.acct, opp: e.opp, linkMethod: 'connector', linkConf: 1, deletedUpstream: del, gist: `Org62 Solutions Event "${e.subject}" (${e.hours ?? 'no'} h) ${e.cc ? 'landed by the app' : 'logged by hand'}${del ? ', later deleted in Org62' : ''}`,
    });
  }

  // opportunity snapshots (history + latest) and team member / DC snapshot items
  for (const o of OPPS) {
    if (o.fc === 'Closed' || o.fc === 'Omitted') continue;
    const row = oppRows[oid(o.key)]!;
    const hist = OPP_HISTORY[o.key] ?? [];
    const base = { stage: o.stage, amount: o.amount, close: row.close_date as string, fc: o.fc, next: OPP_NEXT[o.key] ?? null };
    let prevState = { ...base, stage: hist[0]?.stage ?? base.stage, amount: hist[0]?.amount ?? base.amount, close: hist[0]?.close ?? base.close, fc: hist[0]?.fc ?? base.fc, next: hist[0]?.next ?? null as string | null };
    const states = hist.map((h) => ({ stage: h.stage ?? prevState.stage, amount: h.amount ?? prevState.amount, close: h.close ?? prevState.close, fc: h.fc ?? prevState.fc, next: h.next ?? null, at: at(h.d, h.t ?? '10:30:00'), n: 0 }));
    void prevState;
    const modAt = Date.parse(row.org62_modified_at as string) + 25 * 60000;
    const lastHist = states.length ? Date.parse(states[states.length - 1]!.at) : 0;
    const latestAt = new Date(Math.max(modAt, lastHist + 26 * 3600_000, Date.parse(T_START) + 30 * 60000)).toISOString();
    states.push({ ...base, next: base.next, at: latestAt, n: 0 });
    states.forEach((s, i) => {
      s.n = i;
      const isLatest = i === states.length - 1;
      const stamp = s.at;
      const prod = OPP_PRODUCTS[o.key];
      const products = prod?.p ?? (/(Agent|Copilot|Assist|Assistant)/.test(o.name) ? ['Agentforce'] : ['Data 360']);
      const d360 = prod ? Math.round((s.amount * prod.d360) / 1000) * 1000 : products.includes('Data 360') ? Math.round((s.amount * 0.6) / 1000) * 1000 : null;
      const flex = prod ? Math.round((s.amount * prod.flex) / 1000) * 1000 : s.amount > 300000 ? Math.round((s.amount * 0.15) / 1000) * 1000 : null;
      const prob = { Qualification: 10, Discovery: 20, 'Solution Design': 40, 'Technical Validation': 60, Proposal: 70, Negotiation: 85 }[s.stage] ?? 30;
      const tag = `o62-opp-${o.key}-${isLatest ? 'latest' : 'h' + i}`;
      const hash = sha(JSON.stringify([s.stage, s.amount, s.close, s.fc, s.next, products]));
      const meta = {
        connector: 'org62', itemKind: 'record_snapshot', rec: 'auto', Id: OPP_SF(o.key), AccountId: ACCT_SF(o.acct), AccountName: acctName(o.acct), StageName: s.stage, CloseDate: s.close, Amount: s.amount,
        ForecastCategoryName: s.fc, Type: o.type, IsClosed: false, IsWon: false, OwnerName: NAME(aeOf(o.acct)), oppHints: [OPP_SF(o.key)], accountHints: [ACCT_SF(o.acct), acctName(o.acct)], d360Amount: d360 ?? 0, flexAmount: flex ?? 0, products,
      };
      addItem({
        tag, source: 'org62', kind: 'org62_record_snapshot', connector: 'org62', ext: `Opportunity:${OPP_SF(o.key)}@${stamp}`, parent: OPP_SF(o.key), container: 'Opportunity', dedupe: `org62:Opportunity:${OPP_SF(o.key)}@${stamp}`,
        occurred: stamp, srcUpdated: stamp, firstSeen: addMinutes(stamp, 12), lastSeen: isLatest ? addMinutes(T_SCAN_END, -rng('o62last:' + o.key).int(0, 600)) : addMinutes(states[i + 1]!.at, -30), title: o.name, url: `https://org62.example.com/lightning/r/Opportunity/${OPP_SF(o.key)}/view`,
        body: `stage=${s.stage}; close=${s.close}; amount=${s.amount}; forecast=${s.fc}; closed=false; won=false; next=${(s.next ?? '').slice(0, 120)}`, meta, acct: o.acct, opp: o.key, linkMethod: 'connector', linkConf: 1,
        gist: `Org62 opportunity snapshot ${isLatest ? '(latest)' : '(history ' + i + ')'}: ${o.name}: ${s.stage}, $${s.amount.toLocaleString('en-US')}, close ${s.close}`, noise: false, hashSeed: hash,
      });
      SNAPS.push({ key: o.key, tag, s: { ...s }, latest: isLatest, hash, products, d360, flex, prob, i });
    });
  }
  for (const t of TEAM_ITEMS) {
    const o = OPP_BY_KEY[t.opp]!;
    const row = oppRows[oid(t.opp)]!;
    const stamp = at(t.d, '12:00:00');
    addItem({
      tag: `o62-tm-${t.opp}`, source: 'org62', kind: 'org62_record_snapshot', connector: 'org62', ext: `OpportunityTeamMember:${OPP_SF(t.opp)}:005SMPL00000001AAA@${stamp}`, parent: OPP_SF(t.opp), container: 'OpportunityTeamMember',
      dedupe: `org62:OpportunityTeamMember:${OPP_SF(t.opp)}:005SMPL00000001AAA@${stamp}`, occurred: stamp, firstSeen: addMinutes(stamp, 40), lastSeen: addMinutes(T_SCAN_END, -rng('tm:' + t.opp).int(0, 500)), title: `Me on ${o.name}`,
      body: `team_role=${t.role}; stage=${o.stage}; close=${row.close_date}; amount=${o.amount}; forecast=${o.fc}`, meta: { connector: 'org62', itemKind: 'record_snapshot', rec: 'auto', Id: OPP_SF(t.opp), AccountId: ACCT_SF(o.acct), AccountName: acctName(o.acct), StageName: o.stage, CloseDate: row.close_date, Amount: o.amount, ForecastCategoryName: o.fc, Type: null, IsClosed: false, IsWon: false, TeamMemberRole: t.role, TeamMemberSystemModstamp: stamp, oppHints: [OPP_SF(t.opp)], accountHints: [ACCT_SF(o.acct)] },
      acct: o.acct, opp: t.opp, linkMethod: 'connector', linkConf: 1, gist: `Org62 opp team membership: I am ${t.role} on ${o.name}`, noise: false,
    });
  }
  for (const dc of DC_ITEMS) {
    const o = OPP_BY_KEY[dc.opp]!;
    const id = sfId('a0S', dc.n);
    const stamp = at(dc.d, '13:00:00');
    addItem({
      tag: `o62-dc-${dc.n}`, source: 'org62', kind: 'org62_record_snapshot', connector: 'org62', ext: `Deal_Contribution__c:${id}@${stamp}`, parent: id, container: 'Deal_Contribution__c', dedupe: `org62:Deal_Contribution__c:${id}@${stamp}`,
      occurred: stamp, firstSeen: addMinutes(stamp, 35), lastSeen: addMinutes(T_SCAN_END, -rng('dc:' + dc.n).int(0, 500)), title: `DC on ${o.name}`, body: `role=${dc.role}; split=${dc.split}; opp_stage=${o.stage}; se=Rafael Okonkwo`,
      meta: { connector: 'org62', itemKind: 'record_snapshot', rec: 'auto', Id: id, Opportunity__c: OPP_SF(dc.opp), SE_Name__c: 'Rafael Okonkwo', Opportunity_Role__c: dc.role, Split_Percentage__c: dc.split, IsClosed: true, IsWon: dc.won, oppHints: [OPP_SF(dc.opp)], accountHints: [ACCT_SF(o.acct)] },
      acct: o.acct, opp: dc.opp, linkMethod: 'connector', linkConf: 1, gist: `Org62 Deal Contribution (${dc.role}, ${dc.split}%) on won opp ${o.name}`, noise: false,
    });
  }
}
type SnapSpec = { key: string; tag: string; s: { stage: string; amount: number; close: string; fc: string; next: string | null; at: string }; latest: boolean; hash: string; products: string[]; d360: number | null; flex: number | null; prob: number; i: number };
const SNAPS: SnapSpec[] = [];

export function org62Rows(sid: (tag: string) => string): { events: Row[]; snaps: Row[] } {
  const events: Row[] = ORG62_EVENTS.map((e) => {
    const start = at(e.d, e.t + ':00');
    const item = ITEMS.find((i) => i.tag === `o62-ev-${e.n}`)!;
    return {
      id: uid('org62_events', o62Key(e.n)), owner_user_id: OWNER, org62_event_id: o62Id(e.n), record_type_name: 'Solutions Event', subject: e.subject, starts_at: start, ends_at: addMinutes(start, e.mins), duration_field: e.hours,
      se_task_type_name: e.task, meeting_type_name: e.meeting, what_org62_id: e.opp ? OPP_SF(e.opp) : null, opportunity_id: e.opp ? oid(e.opp) : null, account_id: e.acct ? aid(e.acct) : null,
      org62_created_at: at(e.logged.d, e.logged.t + ':00'), org62_modified_at: stampOf(e), source_item_id: sid(`o62-ev-${e.n}`), first_seen_at: item.firstSeen, last_seen_at: item.lastSeen, deleted_upstream_at: item.deletedUpstream ?? null,
    };
  });
  const lastCap: Record<string, number> = {};
  const capMap = new Map<string, string>();
  for (const p of SNAPS) {
    const fs = Date.parse(ITEMS.find((x) => x.tag === p.tag)!.firstSeen!);
    const c = Math.max(fs, (lastCap[p.key] ?? 0) + 60000);
    lastCap[p.key] = c;
    capMap.set(p.tag, new Date(c).toISOString());
  }
  const capOf = (p: SnapSpec) => capMap.get(p.tag)!;
  const capOf2 = capOf;
  const snaps: Row[] = SNAPS.map((p) => ({
    id: uid('opportunity_snapshots', p.latest ? `${p.key}:latest` : `${p.key}:h${p.i}`), opportunity_id: oid(p.key), source_item_id: sid(p.tag), captured_at: capOf(p), fields_hash: p.hash, stage: p.s.stage, amount: p.s.amount, close_date: p.s.close,
    forecast_category: p.s.fc, is_closed: false, is_won: false, next_step: p.s.next, product_names: p.products, d360_line_amount: p.d360, flex_line_amount: p.flex,
    extra: { probability: p.prob, ownerName: NAME(aeOf(OPP_BY_KEY[p.key]!.acct)), type: OPP_BY_KEY[p.key]!.type, leadSource: p.key.startsWith('elderglen') ? 'Customer referral' : 'Direct', nextStepDate: p.s.next ? p.s.at.slice(0, 10) : null },
    created_at: capOf2(p),
  }));
  return { events, snaps };
}

// ───────────────────────── VDP ─────────────────────────
const vdpRowId = (k: string) => uid('vdp_records', k);
export function assembleVdp(): void {
  VDPS.forEach((v, i) => {
    const ai = v.uc.filter((u) => u.ai).length;
    const last = at(v.lastActDay, '15:00:00');
    const readAt = v.gone ? at(-9, '08:20:00') : at(0, '08:30:00');
    const created = at(v.createdDay, '16:00:00');
    const oppSf = v.opp ? OPP_SF(v.opp) : null;
    addItem({
      tag: `vdp-${v.key}`, source: 'vdp', kind: 'vdp_record_snapshot', connector: 'vdp', ext: `vdp:vdp-smpl-${String(i + 1).padStart(3, '0')}@${last}`, parent: `vdp-smpl-${String(i + 1).padStart(3, '0')}`, container: 'vdp', dedupe: `vdp:vdp-smpl-${String(i + 1).padStart(3, '0')}`,
      occurred: last, srcUpdated: last, firstSeen: addMinutes(Date.parse(created) < Date.parse(T_START) ? T_START : created, 30), lastSeen: readAt, revision: 1 + (i % 4), changedAt: i % 4 ? addMinutes(last, 20) : null, title: `VDP · ${v.company} FY${v.fy ?? 27} Q${v.fq ?? 4}`,
      url: `https://vdp.example/plans/${v.slug}`, body: `VDP ${v.company} FY${v.fy ?? 27} Q${v.fq ?? 4}: use cases ${v.uc.length} (${ai} with AI); assets ${v.assets.length}; AE ${v.ae ? 'yes' : 'no'}; TA ${v.ta ? 'yes' : 'no'}; opp linked`,
      meta: { connector: 'vdp', itemKind: 'record_snapshot', vdpId: `vdp-smpl-${String(i + 1).padStart(3, '0')}`, slug: v.slug, fiscalYear: v.fy ?? 27, fiscalQuarter: v.fq ?? 4, salesforceAccountId: ACCT_SF(v.acct), salesforceOpportunityId: oppSf, salesforceOpportunityIds: oppSf ? [oppSf] : [], useCaseCount: v.uc.length, useCaseWithAiCount: ai, assetCount: v.assets.length, hasAe: v.ae, hasTa: v.ta, archived: !!v.archived, accountHints: [ACCT_SF(v.acct), v.company], oppHints: oppSf ? [oppSf] : [], threadRef: `vdp:${v.slug}` },
      acct: v.acct, opp: v.opp, linkMethod: 'connector', linkConf: 1, deletedUpstream: null, gist: v.gist,
    });
  });
}
export function vdpRows(sid: (tag: string) => string): Row[] {
  return VDPS.map((v, i) => {
    const vid = `vdp-smpl-${String(i + 1).padStart(3, '0')}`;
    const ai = v.uc.filter((u) => u.ai).length;
    const item = ITEMS.find((x) => x.tag === `vdp-${v.key}`)!;
    const ae = P[aeOf(v.acct)]!;
    const oppSf = v.opp ? OPP_SF(v.opp) : null;
    const assets = v.assets.map((a, k) => ({ id: `vdp-as-smpl-${String(i + 1).padStart(2, '0')}${k + 1}`, title: ALL_ASSETS.find((x) => x.tag === a.tag)!.title, type: a.type, url: a.type === 'recording' ? `https://drive.example.com/file/d/${fid(a.tag)}/view` : furl(a.tag, KIND_OF[a.tag] ?? 'doc'), description: a.desc ?? null }));
    const detail = {
      id: vid, slug: v.slug, url: `https://vdp.example/plans/${v.slug}`, company: { id: `co-smpl-${String(i + 1).padStart(3, '0')}`, name: v.company, slug: v.company.toLowerCase().replace(/[^a-z0-9]+/g, '-'), segment: i % 3 === 0 ? 'Enterprise' : 'Commercial', industry: null },
      fiscalYear: v.fy ?? 27, fiscalQuarter: v.fq ?? 4, createdAt: at(v.createdDay, '16:00:00'), updatedAt: at(v.lastActDay, '15:00:00'), lastActivityAt: at(v.lastActDay, '15:00:00'),
      createdBy: { name: NAME('owner'), email: P.owner!.email, placeholder: false },
      aes: v.ae ? [{ name: ae.name, email: ae.email, placeholder: false }] : [], tas: v.ta ? [{ name: NAME('owner'), email: P.owner!.email, placeholder: false }] : [],
      collaborators: (v.collaborators ?? []).map((n) => ({ name: n, email: `${n.toLowerCase().replace(/[^a-z ]/g, '').split(' ').join('.')}@example.com`, placeholder: false })),
      stakeholders: v.stakeholders.map((n, k) => ({ id: `sh-smpl-${i + 1}-${k + 1}`, name: n, notes: null, role: null, title: null })),
      useCases: v.uc.map((u) => ({ id: u.vdpId, name: u.name, hasAi: u.ai, goLiveDate: u.golive, createdAt: at(v.createdDay + 1, '10:00:00') })), assets,
      salesforceAccountId: ACCT_SF(v.acct), salesforceOpportunityId: oppSf, salesforceOpportunityIds: oppSf ? [oppSf] : [], isSeed: false, executiveSummary: null, entitlementLeveraged: null, dcNoteCached: false, archivedAt: v.archived ? at(-30, '12:00:00') : null,
    };
    return {
      id: vdpRowId(v.key), owner_user_id: OWNER, vdp_slug: v.slug, url: `https://vdp.example/plans/${v.slug}`, opportunity_id: v.opp ? oid(v.opp) : null, account_id: aid(v.acct), fiscal_year: v.fy ?? 27, fiscal_quarter: v.fq ?? 4,
      has_ae: v.ae, has_ta: v.ta, use_case_count: v.uc.length, use_case_with_ai_count: ai, asset_count: v.assets.length, dc_note_cached: false, missing_items: v.missing, source_item_id: sid(`vdp-${v.key}`),
      last_seen_at: item.lastSeen, created_at: item.firstSeen, updated_at: item.lastSeen, vdp_id: vid, company_name: v.company, salesforce_account_id: i % 2 ? ACCT_SF(v.acct).slice(0, 15) : ACCT_SF(v.acct),
      salesforce_opportunity_id: oppSf ? (i % 2 ? oppSf.slice(0, 15) : oppSf) : null, archived: !!v.archived, last_activity_at: at(v.lastActDay, '15:00:00'), gone_at: v.gone ? at(-8, '08:20:00') : null, detail,
    };
  });
}

// ───────────────────────── VDP asset candidates ─────────────────────────
const candKind = (tag: string, override?: string) => override ?? (() => { const a = ALL_ASSETS.find((x) => x.tag === tag)!; return a.kind === 'deck' ? 'deck' : a.kind === 'sheet' || a.kind === 'estimate' ? 'sheet' : a.kind === 'pdf' ? 'pdf' : a.kind === 'recording' ? 'recording' : a.kind === 'demo_org' ? 'demo' : a.kind === 'repo_artifact' ? 'link' : 'doc'; })();
export const candidateAssetTags = () => new Set(CANDIDATES.filter((c) => !c.key).map((c) => c.asset));
export function candidateRows(): Row[] {
  const out: Row[] = [];
  for (const c of CANDIDATES) {
    const a = c.key ? null : ALL_ASSETS.find((x) => x.tag === c.asset)!;
    const url = c.url ?? furl(c.asset, KIND_OF[c.asset] ?? 'doc');
    const fileUrl = a?.kind === 'recording' ? `https://drive.example.com/file/d/${fid(c.asset)}/view` : url;
    const needle = c.key ? (c.url ?? '').split('/').pop()! : fid(c.asset);
    const hits = ITEMS.filter((i) => ((i.body ?? '').includes(needle) || JSON.stringify((i.meta as { fileRefs?: unknown }).fileRefs ?? []).includes(needle) || i.asset === c.asset) && i.source !== 'vdp').sort((x, y) => Date.parse(y.occurred) - Date.parse(x.occurred)).slice(0, 8);
    const label = (i: Item) => (i.source === 'slack' ? `#${(i.meta as { channelName?: string }).channelName ?? 'dm'} · ${(i.meta as { author: { name: string } }).author.name}` : i.source === 'gmail' ? `Email: ${i.title}` : i.source === 'calendar' ? `Calendar: ${i.title}` : i.source === 'gemini_notes' ? `Gemini notes: ${i.title}` : `Drive: ${i.title} (${(i.meta as { author?: { name?: string } }).author?.name ?? 'edited'})`);
    const firstSeen = hits.length ? hits.reduce((m, i) => (Date.parse(i.firstSeen ?? i.occurred) < Date.parse(m) ? i.firstSeen ?? i.occurred : m), hits[0]!.firstSeen ?? hits[0]!.occurred) : at(c.day, '11:00:00');
    const lastSeen = hits.length ? hits.reduce((m, i) => (Date.parse(i.lastSeen ?? i.occurred) > Date.parse(m) ? i.lastSeen ?? i.occurred : m), hits[0]!.lastSeen ?? hits[0]!.occurred) : addMinutes(firstSeen, 600);
    const fs = Date.parse(firstSeen) < Date.parse(T_START) ? addMinutes(T_START, 60) : firstSeen;
    const closed = c.status === 'dismissed' || c.status === 'added';
    const statusAt = c.status === 'suggested' || c.status === 'unsure' ? null : c.status === 'in_vdp' ? at(-1 + (c.day % 3 === 0 ? -1 : 0), '08:12:00') : addMinutes(fs, 1400 + Math.abs(c.day) * 31);
    const acctKey = c.acct;
    const vdp = VDPS.find((v) => v.slug === c.slug);
    const targetKey = aid(acctKey);
    out.push({
      id: uid('vdp_asset_candidates', `${acctKey}:${c.asset}`), owner_user_id: OWNER, target_key: targetKey, vdp_slug: c.slug, account_id: aid(acctKey), company_name: vdp?.company ?? acctName(acctKey), title: c.title ?? a!.title, url: fileUrl,
      asset_key: c.key ?? (a!.system === 'tool' ? `demo:${c.asset}` : `drive:${fid(c.asset)}`), kind: candKind(c.asset, c.kind), why: c.why, confidence: c.conf, origin: c.origin, status: c.status,
      sources: hits.map((i) => ({ source: i.source, label: label(i), url: i.url ?? null, at: i.occurred })), source_item_ids: hits.map((i) => uid('source_items', i.key!)), first_seen_at: fs,
      last_seen_at: Date.parse(lastSeen) < Date.parse(fs) ? fs : Date.parse(lastSeen) > Date.parse(T_SCAN_END) ? T_SCAN_END : lastSeen, status_at: statusAt, created_at: fs, updated_at: statusAt ?? lastSeen,
    });
    void closed;
  }
  return out;
}

// ───────────────────────── Claude sessions ─────────────────────────
export const sessionId = (key: string) => `${sha('cs:' + key).slice(0, 8)}-smpl-${sha('cs2:' + key).slice(0, 4)}-${sha('cs3:' + key).slice(0, 12)}`;
export function assembleClaude(): void {
  for (const s of CLAUDE_SESSIONS) {
    const start = at(s.d, s.start + ':00');
    const end = at(s.d, s.end + ':00');
    const r = rng(`cs:${s.key}`);
    const span = Date.parse(end) - Date.parse(start);
    const turns: string[][] = [];
    for (let k = 0; k < s.prompts; k++) {
      const a = Date.parse(start) + Math.floor((span * k) / s.prompts);
      turns.push([new Date(a).toISOString(), new Date(a + Math.floor((span / s.prompts) * (0.5 + r.next() * 0.4))).toISOString()]);
    }
    const sid0 = sessionId(s.key);
    addItem({
      tag: s.key, source: 'claude', kind: 'claude_session', connector: 'claude', ext: sid0, parent: null, container: s.cwd, dedupe: `claude:${sid0}`, occurred: end, firstSeen: addMinutes(end, r.int(3, 15)), lastSeen: addMinutes(end, r.int(15, 400)),
      actor: 'owner', fromMe: true, repo: s.repo, title: s.title, url: null, body: s.summary,
      meta: { connector: 'claude_sessions', itemKind: 'claude_session', sessionId: sid0, hostSessionId: `host-${sha(s.key).slice(0, 8)}`, status: s.status, statusReason: s.status === 'waiting' ? 'Waiting for input' : 'Turn finished', statusConfidence: 'high', statusSoft: false, statusAgeSeconds: 600, resumable: true, hasLiveProcess: false, entrypoint: 'cli', cwd: s.cwd, repo: s.repo, branch: s.branch, startedAt: start, lastActivityAt: end, lastHumanPromptAt: turns[turns.length - 1]![0], humanPromptCount: s.prompts, humanTurns: turns, backgroundAgents: s.bg ?? 0, backgroundAgentLabels: s.bg ? ['explore'] : [], compactions: s.compactions ?? 0, filesTouched: s.files, filesTouchedCount: s.files.length, archived: false, scheduled: false, title: s.title, threadRef: `claude-session:${sid0}` },
      acct: s.acct, opp: s.opp, linkMethod: 'rule', linkRule: s.repo === 'saltmere-poc-demo' ? 'repo-saltmere' : s.repo === 'ferrowpay-fraud-agent' ? 'repo-ferrowpay' : undefined, linkConf: s.repo === 'shared-demo-kit' ? 0.7 : 0.95,
      gist: `Claude session "${s.title}" in ${s.repo} (${s.prompts} prompts, ${s.start}-${s.end} MT)`, noise: !s.acct,
    });
  }
}
void pid;
