/** Domain 02 assembly: assets, snapshots, per-section digests, diffs and the Drive source items behind them. */
import { OWNER, rng } from '../../lib/kit';
import { noteAssets } from './sources-asm-cal';
import { ASSETS, DELIVERABLES, KIND_OF, type AssetDef, type Deliv } from './sources-drive';
import { OWNER_EMAIL, P, NAME, T_NOW, T_START, aid, addItem, addMinutes, at, fid, furl, itemByTag, ITEMS, oid, pid, scanN, sha, uid, type Item } from './sources-lib';

type Row = Record<string, unknown>;
type SecI = { key: string; title: string; text: string; hash: string };
type VerI = { n: number; tag: string; modified: string; sampled: string; who: string; secs: SecI[]; hash: string; words: number; snapId: string; itemTag: string; status: string };
export const VERS: Record<string, VerI[]> = {};
export const ALL_ASSETS: AssetDef[] = [];
const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
const secOf = (s: { key: string; title: string; text: string }): SecI => ({ ...s, hash: sha(s.text) });

function applyOps(secs: SecI[], ops: NonNullable<Deliv['versions'][number]['ops']> | undefined): SecI[] {
  let out = [...secs];
  for (const op of ops ?? []) {
    if (op[0] === 'mod') out = out.map((s) => (s.key === op[1] ? secOf({ key: s.key, title: op[3] ?? s.title, text: op[2] }) : s));
    else if (op[0] === 'del') out = out.filter((s) => s.key !== op[1]);
    else if (op[0] === 'add') {
      const idx = op[4] === null ? 0 : out.findIndex((s) => s.key === op[4]) + 1;
      out.splice(idx, 0, secOf({ key: op[1], title: op[2], text: op[3] }));
    } else if (op[0] === 'mv') {
      const cur = out.find((s) => s.key === op[1])!;
      out = out.filter((s) => s.key !== op[1]);
      const idx = op[2] === null ? 0 : out.findIndex((s) => s.key === op[2]) + 1;
      out.splice(idx, 0, cur);
    }
  }
  return out;
}
const fileKindWord = (k: string) => (k === 'deck' ? 'slides' : k === 'sheet' ? 'sheet' : 'doc');
const mimeOf = (a: AssetDef) => a.mime ?? (a.kind === 'deck' ? 'application/vnd.google-apps.presentation' : a.kind === 'sheet' || a.kind === 'estimate' ? 'application/vnd.google-apps.spreadsheet' : a.kind === 'pdf' ? 'application/pdf' : a.kind === 'recording' ? 'video/mp4' : 'application/vnd.google-apps.document');
const asset = (tag: string) => ALL_ASSETS.find((a) => a.tag === tag)!;
const assetModIso = (a: AssetDef) => a.modIso ?? at(a.mod, a.modT ?? '11:00');

type DiffI = { id: string; asset: string; from: VerI; to: VerI; kind: 'consecutive' | 'since_baseline'; counts: { add: number; rem: number; mod: number; mov: number }; wAdd: number; wRem: number; keys: string[]; mods: string[]; summary: string; changes: Array<Record<string, string | null>>; llm: number | null; slideChange: Record<string, unknown> };
const DIFFS: DiffI[] = [];

function computeDiff(dl: Deliv, from: VerI, to: VerI, kind: DiffI['kind'], llm: number | null, modifiers: string[]): DiffI {
  const fm = new Map(from.secs.map((s, i) => [s.key, { s, i }]));
  const tm = new Map(to.secs.map((s, i) => [s.key, { s, i }]));
  const added = to.secs.filter((s) => !fm.has(s.key));
  const removed = from.secs.filter((s) => !tm.has(s.key));
  const modified = to.secs.filter((s) => fm.has(s.key) && fm.get(s.key)!.s.hash !== s.hash);
  const commonFrom = from.secs.filter((s) => tm.has(s.key)).map((s) => s.key);
  const commonTo = to.secs.filter((s) => fm.has(s.key)).map((s) => s.key);
  const moved = commonTo.filter((k, i) => commonFrom[i] !== k);
  const movedKeys = moved.length > 1 ? moved.slice(0, 1) : [];
  const sum = (xs: SecI[]) => xs.reduce((n, s) => n + words(s.text) * dl.mult, 0);
  const wAdd = sum(added) + sum(modified);
  const wRem = sum(removed) + Math.round(modified.reduce((n, s) => n + words(fm.get(s.key)!.s.text) * dl.mult * 0.6, 0));
  const parts = [...added.map((s) => `added '${s.title}'`), ...modified.map((s) => `edited '${s.title}'`), ...removed.map((s) => `removed '${from.secs.find((x) => x.key === s.key)!.title}'`), ...movedKeys.map((k) => `moved '${to.secs.find((x) => x.key === k)!.title}'`)];
  const changes = [
    ...added.map((s) => ({ sectionKey: s.key, change: 'added', beforeHash: null, afterHash: s.hash })),
    ...removed.map((s) => ({ sectionKey: s.key, change: 'removed', beforeHash: s.hash, afterHash: null })),
    ...modified.map((s) => ({ sectionKey: s.key, change: 'modified', beforeHash: fm.get(s.key)!.s.hash, afterHash: s.hash })),
    ...movedKeys.map((k) => ({ sectionKey: k, change: 'moved', beforeHash: fm.get(k)!.s.hash, afterHash: tm.get(k)!.s.hash })),
  ];
  const keys = [...new Set(changes.map((c) => c.sectionKey as string))];
  const lines = (t: string) => t.split(/(?<=[.;:])\s+/).slice(0, 3);
  const slideChange: Record<string, unknown> = {};
  const delta = (b: string, a: string) => ({ before: b.slice(0, 160), after: a.slice(0, 160), linesAdded: lines(a).filter((l) => !b.includes(l)), linesRemoved: lines(b).filter((l) => !a.includes(l)) });
  if (dl.fkind === 'deck') {
    Object.assign(slideChange, {
      slides: {
        countBefore: from.secs.length, countAfter: to.secs.length,
        added: added.map((s) => ({ objectId: s.key, n: to.secs.indexOf(s) + 1, title: s.title, text: s.text.slice(0, 160) })),
        removed: removed.map((s) => ({ objectId: s.key, n: from.secs.indexOf(s) + 1, title: s.title, text: s.text.slice(0, 160) })),
        changed: modified.map((s) => ({ objectId: s.key, n: to.secs.indexOf(s) + 1, nBefore: fm.get(s.key)!.i + 1, titleBefore: fm.get(s.key)!.s.title, titleAfter: s.title, elementCountBefore: 3, elementCountAfter: 3, kinds: ['text'], ...delta(fm.get(s.key)!.s.text, s.text) })),
        moved: movedKeys.map((k) => ({ objectId: k, from: fm.get(k)!.i + 1, to: tm.get(k)!.i + 1, title: tm.get(k)!.s.title })),
      },
    });
  } else if (dl.fkind === 'doc') {
    Object.assign(slideChange, { sections: { added: added.map((s) => ({ key: s.key, heading: s.title, text: s.text.slice(0, 160) })), removed: removed.map((s) => ({ key: s.key, heading: s.title, text: s.text.slice(0, 160) })), changed: modified.map((s) => ({ key: s.key, heading: s.title, ...delta(fm.get(s.key)!.s.text, s.text) })) } });
  } else {
    Object.assign(slideChange, { sheets: { added: added.map((s) => ({ name: s.title })), removed: removed.map((s) => ({ name: s.title })), changed: modified.map((s) => ({ name: s.title, ...delta(fm.get(s.key)!.s.text, s.text) })) } });
  }
  return { id: uid('asset_snapshot_diffs', `${dl.tag}:${from.n}-${to.n}`), asset: dl.tag, from, to, kind, counts: { add: added.length, rem: removed.length, mod: modified.length, mov: movedKeys.length }, wAdd, wRem, keys, mods: modifiers, summary: parts.length ? parts.join('; ') : 'no visible change', changes, llm, slideChange };
}

export function assembleDrive(): void {
  for (const a of ASSETS) ALL_ASSETS.push(a);
  for (const a of noteAssets) ALL_ASSETS.push(a);
  for (const a of ALL_ASSETS) if (!KIND_OF[a.tag]) KIND_OF[a.tag] = a.kind === 'deck' ? 'deck' : a.kind === 'sheet' ? 'sheet' : 'doc';

  let llmN = 0;
  for (const dl of DELIVERABLES) {
    const a = asset(dl.tag);
    let cur: SecI[] = dl.base.map(secOf);
    const vers: VerI[] = [];
    dl.versions.forEach((v, i) => {
      cur = i === 0 ? cur : applyOps(cur, v.ops);
      const modified = at(v.d, v.t.length === 5 ? v.t + ':00' : v.t);
      const r = rng(`snap:${dl.tag}:${i}`);
      const sampled = addMinutes(modified, a.tier === 'watched' ? r.int(3, 9) : r.int(25, 700));
      const hash = sha(cur.map((s) => s.hash).join('|'));
      const n = i + 1;
      vers.push({ n, tag: dl.tag, modified, sampled, who: v.who, secs: cur, hash, words: cur.reduce((t, s) => t + words(s.text) * dl.mult, 0), snapId: uid('asset_snapshots', `${dl.tag}:v${n}`), itemTag: `dr-${dl.tag}-v${n}`, status: 'ok' });
    });
    VERS[dl.tag] = vers;
    for (let i = 1; i < vers.length; i++) {
      const llm = (i + dl.tag.length) % 3 === 0 ? 100 + (++llmN) * 23 : null;
      DIFFS.push(computeDiff(dl, vers[i - 1]!, vers[i]!, 'consecutive', llm, [vers[i]!.who]));
    }
    if (vers.length >= 3) DIFFS.push(computeDiff(dl, vers[0]!, vers[vers.length - 1]!, 'since_baseline', 100 + (++llmN) * 23, [...new Set(vers.slice(1).map((v) => v.who))]));
    // source items
    vers.forEach((v, i) => {
      const prev = vers[i - 1];
      const d = prev ? DIFFS.find((x) => x.id === uid('asset_snapshot_diffs', `${dl.tag}:${prev.n}-${v.n}`))! : null;
      const user = { name: NAME(v.who), email: P[v.who]?.email };
      const change = d
        ? {
            kind: dl.fkind === 'deck' ? 'slides' : dl.fkind,
            from: { modifiedTime: prev!.modified, digestHash: prev!.hash.slice(0, 16), sampledAt: prev!.sampled, user: { name: NAME(prev!.who), email: P[prev!.who]?.email } },
            to: { modifiedTime: v.modified, digestHash: v.hash.slice(0, 16), sampledAt: v.sampled, user },
            ...d.slideChange,
            counts: { added: d.counts.add, removed: d.counts.rem, changed: d.counts.mod, moved: d.counts.mov },
            summary: d.summary,
            limits: dl.fkind === 'deck' ? ['speaker notes are not compared', 'images and charts are not compared'] : dl.fkind === 'sheet' ? ['formulas are compared as values only'] : ['comments and suggestions are not compared'],
          }
        : undefined;
      const kindWord = fileKindWord(dl.fkind);
      addItem({
        tag: v.itemTag, source: 'drive', kind: 'drive_file_revision', connector: 'drive', ext: `${fid(dl.tag)}@${v.modified}`, parent: fid(dl.tag), container: 'drive',
        dedupe: `drive:${fid(dl.tag)}@${v.modified}`, occurred: v.modified, srcUpdated: v.modified, firstSeen: v.sampled, lastSeen: v.sampled, actor: v.who, actorExt: P[v.who]?.email,
        fromMe: v.who === 'owner', toMe: false, asset: dl.tag, title: a.title, url: furl(dl.tag, dl.fkind),
        body: `${kindWord} edited${v.who === 'owner' ? ' by me' : ' by ' + NAME(v.who)}: ${d ? d.summary : `first sample, ${v.secs.length} sections`}`,
        meta: { connector: 'drive', itemKind: 'file_revision', fileId: fid(dl.tag), fileKind: dl.fkind === 'deck' ? 'slides' : dl.fkind, modifiedTime: v.modified, lastModifyingUser: user, editedByMe: v.who === 'owner', sampledAt: v.sampled, author: { name: user.name, email: user.email, isMe: v.who === 'owner' }, ...(change ? { change } : {}), contentKey: v.hash.slice(0, 16), fileRefs: [fid(dl.tag)], threadRef: `drive:${fid(dl.tag)}` },
        acct: a.acct, opp: a.opp, linkMethod: a.map ?? 'llm', linkConf: a.conf ?? 0.8, gist: `Drive revision v${v.n} of '${a.title}' by ${v.who === 'owner' ? 'me' : NAME(v.who)}: ${d ? d.summary : 'first sample'}`,
        links: [{ to: 'asset', key: dl.tag, role: 'about', method: 'connector', conf: 1 }],
      });
    });
  }

  // two odd snapshots: a customer file we cannot read, and a PDF
  for (const [tag, status, ext, d, t, who] of [['hv-sec-q', 'permission_denied', 'drive.metadata@1', -1, '14:40', 'hv-soojin'], ['se-privacy', 'unsupported', 'drive.metadata@1', -20, '10:30', 'mgr']] as Array<[string, string, string, number, string, string]>) {
    const a = asset(tag);
    const modified = at(d, t + ':00');
    const sampled = addMinutes(modified, 45);
    const n = 1;
    VERS[tag] = [{ n, tag, modified, sampled, who, secs: [], hash: sha(`opaque:${tag}`), words: 0, snapId: uid('asset_snapshots', `${tag}:v1`), itemTag: `dr-${tag}-v1`, status }];
    addItem({
      tag: `dr-${tag}-v1`, source: 'drive', kind: 'drive_file_revision', connector: 'drive', ext: `${fid(tag)}@${modified}`, parent: fid(tag), container: 'drive', dedupe: `drive:${fid(tag)}@${modified}`, occurred: modified, srcUpdated: modified, firstSeen: sampled, lastSeen: sampled,
      actor: who, actorExt: P[who]?.email, fromMe: false, asset: tag, title: a.title, url: furl(tag, KIND_OF[tag]!),
      body: status === 'permission_denied' ? 'sheet modified by Soo-jin Baek; content not readable (permission denied)' : 'pdf modified; digest is size and modified time only',
      meta: { connector: 'drive', itemKind: 'file_revision', fileId: fid(tag), fileKind: status === 'unsupported' ? 'other' : 'sheet', modifiedTime: modified, lastModifyingUser: { name: NAME(who), email: P[who]?.email }, editedByMe: false, sampledAt: sampled, author: { name: NAME(who), email: P[who]?.email, isMe: false }, change: status === 'unsupported' ? { kind: 'other', opaque: { sizeBefore: 812_000, sizeAfter: 846_000 }, counts: { added: 0, removed: 0, changed: 0, moved: 0 }, summary: 'file changed (size 812 KB to 846 KB)', limits: ['content of this file type cannot be read as text'] } : undefined, fileRefs: [fid(tag)] },
      acct: a.acct, opp: a.opp, linkMethod: a.map ?? 'llm', linkConf: a.conf ?? 0.8, gist: `Drive revision of '${a.title}' (${status})`, links: [{ to: 'asset', key: tag, role: 'about', method: 'connector', conf: 1 }],
    });
  }
}

/** Items for assets that have no revision history, so candidates and links have a source (called after chat/mail exist). */
export function ensureDriveItems(candidateAssets: Set<string>): void {
  const mentioned = (a: AssetDef) => ITEMS.some((i) => i.asset === a.tag || (i.body ?? '').includes(fid(a.tag)) || JSON.stringify((i.meta as { fileRefs?: string[] }).fileRefs ?? []).includes(fid(a.tag)));
  for (const a of ALL_ASSETS) {
    if (VERS[a.tag] || a.tag.startsWith('gn-') || a.system === 'tool' || a.system === 'local_fs') continue;
    if (!(a.mine || candidateAssets.has(a.tag) || !mentioned(a))) continue;
    const modified = assetModIso(a);
    const sampled = addMinutes(modified, rng(`hist:${a.tag}`).int(30, 900));
    const first = Date.parse(sampled) < Date.parse(T_START);
    const user = { name: NAME(a.by), email: P[a.by]?.email };
    const kw = fileKindWord(KIND_OF[a.tag] ?? 'doc');
    addItem({
      tag: `dr-${a.tag}`, source: 'drive', kind: 'drive_file_revision', connector: 'drive', ext: `${fid(a.tag)}@${modified}`, parent: fid(a.tag), container: 'drive', dedupe: `drive:${fid(a.tag)}@${modified}`, occurred: modified, srcUpdated: modified,
      firstSeen: new Date(Math.max(Date.parse(sampled), Date.parse(T_START) + 40 * 60000)).toISOString(), lastSeen: new Date(Math.max(Date.parse(sampled), Date.parse(T_START) + 40 * 60000)).toISOString(), actor: a.by, actorExt: user.email, fromMe: a.by === 'owner', asset: a.tag, title: a.title,
      url: a.kind === 'recording' ? `https://drive.example.com/file/d/${fid(a.tag)}/view` : furl(a.tag, KIND_OF[a.tag] ?? 'doc'),
      body: `${a.kind === 'recording' ? 'video' : kw} ${a.by === 'owner' ? 'last edited by me' : 'edited by ' + NAME(a.by)}${first ? ' (before the first scan; no change digest)' : ''}`,
      meta: { connector: 'drive', itemKind: 'file_revision', fileId: fid(a.tag), fileKind: a.kind === 'deck' ? 'slides' : a.kind === 'sheet' || a.kind === 'estimate' ? 'sheet' : a.kind === 'doc' ? 'doc' : 'other', modifiedTime: modified, lastModifyingUser: user, editedByMe: a.by === 'owner', history: true, author: { name: user.name, email: user.email, isMe: a.by === 'owner' }, fileRefs: [fid(a.tag)] },
      acct: a.acct, opp: a.opp, linkMethod: a.map ?? 'llm', linkConf: a.conf ?? 0.8, gist: `Drive: '${a.title}' ${a.by === 'owner' ? 'last edited by me' : 'edited by ' + NAME(a.by)}`, noise: !a.acct && !a.mine,
      links: [{ to: 'asset', key: a.tag, role: 'about', method: 'connector', conf: 1 }],
    });
  }
}

export function driveRows(sid: (tag: string) => string): { assets: Row[]; snaps: Row[]; sections: Row[]; diffs: Row[] } {
  const assets: Row[] = [];
  const snaps: Row[] = [];
  const sections: Row[] = [];
  const diffs: Row[] = [];
  for (const a of ALL_ASSETS) {
    const vers = VERS[a.tag];
    const last = vers?.[vers.length - 1];
    const modIso = last ? last.modified : assetModIso(a);
    const myVers = (vers ?? []).filter((v) => v.who === 'owner');
    const byMeAt = a.by === 'owner' || a.mine ? modIso : myVers.length ? myVers[myVers.length - 1]!.modified : null;
    const isRec = a.kind === 'recording';
    const sys = a.system ?? 'drive';
    const fileId = a.fileId ?? fid(a.tag);
    const item = itemByTag(`dr-${a.tag}`) ?? itemByTag(vers?.[0]?.itemTag ?? '') ?? itemByTag(`gn-${a.tag.slice(3)}`);
    const created = a.createdIso ?? (item?.firstSeen ? addMinutes(item.firstSeen, -90) : addMinutes(modIso, -60));
    assets.push({
      id: uid('assets', a.tag), owner_user_id: OWNER, system: sys, external_id: sys === 'tool' ? 'demo-org:smpl-hv-poc' : sys === 'local_fs' ? '/Users/rafael/Projects/saltmere-poc-demo/README.md' : fileId, kind: a.kind,
      title: a.title, url: a.url ?? (sys === 'tool' ? 'https://demo-org.example.com/orgs/smpl-hv-poc' : sys === 'local_fs' ? null : isRec ? `https://drive.example.com/file/d/${fileId}/view` : furl(a.tag, KIND_OF[a.tag] ?? 'doc')),
      mime_type: sys === 'tool' || sys === 'local_fs' ? null : mimeOf(a), owner_person_id: a.owner ? pid(a.owner) : null, i_own: a.owner === 'owner', last_modified_at: modIso, last_modifying_person_id: pid(a.by),
      last_modified_by_me_at: byMeAt, head_revision_id: vers ? `smplrev${a.tag.replace(/[^a-z0-9]/g, '')}${last!.n}` : null, drive_version: vers ? 30 + last!.n * 7 : null,
      tracking_tier: a.tier ?? 'inventory', watched_until: a.tier === 'watched' ? at(3, '17:00') : null, latest_snapshot_id: last ? last.snapId : null,
      account_id: a.acct ? aid(a.acct) : null, opportunity_id: a.opp ? oid(a.opp) : null, mapping_method: a.acct ? a.map ?? 'llm' : null, mapping_confidence: a.acct ? a.conf ?? 0.8 : null, mapping_locked: !!a.locked,
      repo_id: a.tag === 'hv-repo' ? uid('repos', 'saltmere-poc-demo') : null, archived_at: a.tag === 'sc-1' || a.tag === 'sc-8' ? at(-3, '09:30') : null, created_at: created, updated_at: item?.lastSeen ?? modIso,
    });
  }
  for (const [tag, vers] of Object.entries(VERS)) {
    const dl = DELIVERABLES.find((d) => d.tag === tag);
    const a = asset(tag);
    for (const v of vers) {
      snaps.push({
        id: v.snapId, asset_id: uid('assets', tag), source_item_id: sid(v.itemTag), scan_run_id: itemByTag(v.itemTag)!.firstRun ?? uid('scan_runs', scanN(v.sampled)), sampled_at: v.sampled, modified_time: v.modified,
        last_modifying_person_id: pid(v.who), last_modifying_identity: P[v.who]?.email ?? NAME(v.who), modified_by_me: v.who === 'owner', head_revision_id: `smplrev${tag.replace(/[^a-z0-9]/g, '')}${v.n}`, drive_version: 30 + v.n * 7,
        title: a.title, content_hash: v.hash, section_count: v.secs.length, word_count: v.words, extractor: dl?.extractor ?? 'drive.metadata@1', status: v.status, created_at: v.sampled,
      });
      v.secs.forEach((s, i) => {
        const r = rng(`sec:${tag}:${v.n}:${s.key}`);
        sections.push({
          snapshot_id: v.snapId, ordinal: i + 1, section_key: s.key, kind: dl!.fkind === 'deck' ? 'slide' : dl!.fkind === 'sheet' ? 'sheet_tab' : 'heading_section', title: s.title, content_hash: s.hash,
          speaker_notes_hash: dl!.fkind === 'deck' && r.chance(0.45) ? sha(`notes:${tag}:${s.key}`) : null, word_count: words(s.text) * dl!.mult, text: s.text, text_expires_at: addMinutes(v.sampled, 30 * 1440),
        });
      });
    }
  }
  for (const d of DIFFS) {
    diffs.push({
      id: d.id, asset_id: uid('assets', d.asset), from_snapshot_id: d.from.snapId, to_snapshot_id: d.to.snapId, kind: d.kind, sections_added: d.counts.add, sections_removed: d.counts.rem, sections_modified: d.counts.mod, sections_moved: d.counts.mov,
      words_added: d.wAdd, words_removed: d.wRem, changed_section_keys: d.keys, modified_by_me_only: d.mods.every((m) => m === 'owner'), modifier_person_ids: d.mods.map((m) => pid(m)), summary: d.summary, changes: d.changes,
      summary_llm_call_id: d.llm, computed_at: addMinutes(d.to.sampled, 2),
    });
  }
  void T_NOW;
  void OWNER_EMAIL;
  return { assets, snaps, sections, diffs };
}
export const diffCount = () => DIFFS.length;
export type { Item };

/** After scan runs are assigned: a snapshot's sampled_at is the first_seen of its Drive item. */
export function fixSampledAt(): void {
  for (const vers of Object.values(VERS)) {
    vers.forEach((v, i) => {
      const it = itemByTag(v.itemTag)!;
      v.sampled = it.firstSeen!;
      it.meta['sampledAt'] = v.sampled;
      const ch = it.meta['change'] as { to?: { sampledAt?: string }; from?: { sampledAt?: string } } | undefined;
      if (ch?.to) ch.to.sampledAt = v.sampled;
      const nxt = vers[i + 1];
      if (nxt) { const nc = itemByTag(nxt.itemTag)!.meta['change'] as { from?: { sampledAt?: string } } | undefined; if (nc?.from) nc.from.sampledAt = v.sampled; }
    });
  }
}
