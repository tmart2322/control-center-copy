/** Domain 01 (core): the owner, cast, accounts, opportunities and every config table. Run: npx tsx sample-data/generators/01-core.ts */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { OWNER, SAMPLE_DIR, at, addMinutes, day, flushRefs, NOW, ref, sfId, sha, slackChannel, slackDm, slackUser, uid, writeTable, type Row } from '../lib/kit';
import { ACCOUNTS, OPPS, type OppDef } from './data/core-deals';
import { PEOPLE, type PersonDef } from './data/core-people';
import { buildConfig } from './data/core-build';

const U = (t: string, k: string | number) => uid(t, k);
const T0 = at(-31, '08:10'); // app installed; first scan ~30 days ago
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9.@]+/g, ' ').trim();

// ───────────────────────── people ─────────────────────────
const internalOrder = PEOPLE.filter((p) => p.aff === 'internal').map((p) => p.key);
const org62User = (key: string) => sfId('005', internalOrder.indexOf(key) + 1);
const contacts = PEOPLE.filter((p) => p.org62 === 'contact').map((p) => p.key);
const org62Contact = (key: string) => sfId('003', contacts.indexOf(key) + 1);

const people: Row[] = PEOPLE.map((p, i) => ({
  id: U('people', p.key), owner_user_id: OWNER, display_name: p.name, primary_email: p.email, title: p.title, affiliation: p.aff,
  account_id: p.acct ? U('accounts', p.acct) : null, tier: p.tier, is_me: p.key === 'owner',
  merged_into_person_id: p.key === 'hv-mari-dup' ? U('people', 'hv-marisol') : null,
  archived_at: p.key === 'hv-mari-dup' ? at(-6, '10:20') : null,
  created_at: p.key === 'owner' ? T0 : addMinutes(T0, 5 + i * 3), updated_at: p.key === 'hv-mari-dup' ? at(-6, '10:20') : addMinutes(T0, 5 + i * 3),
}));

const identities: Row[] = [];
const idn = (p: PersonDef, system: string, ext: string, handle: string | null, primary: boolean, method: string, conf = 1, verified = false) =>
  identities.push({ id: U('person_identities', `${p.key}:${system}:${ext}`), owner_user_id: OWNER, person_id: U('people', p.key), system, external_id: ext, handle, is_primary: primary, method, confidence: conf, verified_at: verified ? at(-30, '09:00') : null, created_at: people.find((r) => r.id === U('people', p.key))!.created_at });
for (const p of PEOPLE) {
  const short = p.name.toLowerCase().replace(/[^a-z ]/g, '').split(' ');
  if (p.key === 'hv-mari-dup') { idn(p, 'email', p.email, p.email, false, 'connector', 0.55); continue; }
  idn(p, 'email', p.email, p.email, true, p.key === 'hv-marisol' ? 'user' : 'connector', 1, p.key === 'owner');
  if (p.slack) idn(p, 'slack', slackUser(p.slack), `${short[0]}.${short[short.length - 1]}`, p.key === 'owner', p.key === 'hv-marisol' ? 'user' : 'connector', 1, p.key === 'owner');
  if (p.aff === 'internal') { idn(p, 'google', `smpl-google-${p.slack}`, p.email, false, 'connector'); idn(p, 'org62_user', org62User(p.key), null, p.key === 'owner', 'connector'); }
  if (p.org62 === 'contact') idn(p, 'org62_contact', org62Contact(p.key), null, false, 'connector', 0.95);
}
// the duplicate's Slack display name became the merged person's alternate handle
identities.push({ id: U('person_identities', 'hv-marisol:slack:alt'), owner_user_id: OWNER, person_id: U('people', 'hv-marisol'), system: 'slack', external_id: slackUser(39), handle: 'mari.q', is_primary: false, method: 'user', confidence: 1, verified_at: at(-6, '10:20'), created_at: at(-6, '10:20') });

// ───────────────────────── accounts ─────────────────────────
const acctIndex = new Map(ACCOUNTS.map((a, i) => [a.key, i + 1]));
const accounts: Row[] = ACCOUNTS.map((a, i) => ({
  id: U('accounts', a.key), owner_user_id: OWNER, org62_account_id: sfId('001', i + 1), name: a.name,
  parent_account_id: a.parent ? U('accounts', a.parent) : null, family: a.family, industry: a.industry,
  is_my_book: a.book, is_watched: a.watched, notes: a.story, archived_at: null, created_at: T0, updated_at: at(-2 - (i % 5), '12:00'),
}));
const aliases: Row[] = [];
const alias = (a: string, kind: string, value: string, source: string, conf = 1) => {
  const nv = norm(value);
  if (aliases.some((r) => r.account_id === U('accounts', a) && r.kind === kind && r.normalized_value === nv)) return;
  aliases.push({ id: U('account_aliases', `${a}:${kind}:${nv}`), account_id: U('accounts', a), kind, value, normalized_value: nv, source, confidence: conf, created_at: T0 });
};
for (const a of ACCOUNTS) {
  alias(a.key, 'name', a.name, 'seed'); a.short.forEach((s, i) => alias(a.key, 'short_name', s, i === 0 ? 'seed' : 'user_correction'));
  a.domains.forEach((d) => alias(a.key, 'domain', d, 'seed'));
  alias(a.key, 'channel_pattern', `${a.key.split('-')[0]}-*`, 'llm_suggested', 0.8);
  alias(a.key, 'repo_path', a.key, 'llm_suggested', 0.7);
}
alias('saltmere', 'title_token', 'Saltmere POC', 'user_correction'); alias('saltmere', 'title_token', 'HHP', 'seed');
alias('yarrowdale', 'regex', '^yarrowdale( health)?( system)?\\b', 'user_correction'); alias('yarrowdale-mg', 'title_token', 'AMG', 'seed'); alias('yarrowdale-bh', 'title_token', 'ABH', 'seed');
alias('elderglen', 'name', 'Elderglen Holdings (former name)', 'user_correction', 0.9); alias('elderglen-outdoors', 'title_token', 'TOD renewal', 'user_correction');
alias('cascadia', 'title_token', 'Cascadia onsite', 'user_correction'); alias('harrowgate', 'name', 'Harrowgate Mfg', 'llm_suggested', 0.85);

// ───────────────────────── opportunities ─────────────────────────
const oppIdx = new Map(OPPS.map((o, i) => [o.key, i + 1]));
const isClosed = (o: OppDef) => o.stage.startsWith('Closed');
const opportunities: Row[] = OPPS.map((o, i) => ({
  id: U('opportunities', o.key), owner_user_id: OWNER, account_id: U('accounts', o.acct), org62_opportunity_id: sfId('006', i + 1), name: o.name,
  stage: o.stage, amount: o.amount, currency_code: 'USD', close_date: day(o.close), forecast_category: o.fc, type: o.type,
  is_closed: isClosed(o), is_won: o.stage === 'Closed Won', last_activity_date: o.lastAct === null ? null : day(o.lastAct),
  on_my_team: o.mine, my_team_role: o.mine ? (o.seRole ?? 'Solutions Engineer') : null, is_watched: !!o.watched,
  latest_snapshot_id: isClosed(o) ? null : ref('opportunity_snapshots', `${o.key}:latest`, 'newest Org62 snapshot of this open opportunity (domain 02 creates one per open opp; snapshot.opportunity_id = uid(opportunities, key))'),
  org62_modified_at: at(Math.min(0, (o.lastAct ?? -30) + 0), '10:30'), archived_at: null, created_at: T0,
  updated_at: at(Math.min(0, o.lastAct ?? -30), '10:30'),
}));

const ownerAe = (acct: string) => ACCOUNTS.find((a) => a.key === acct)!.ae;
const peers = ['se-ioana', 'se-tariq', 'se-linnea'];
const tm: Row[] = [];
const addTm = (o: OppDef, personKey: string, role: string, opts: { me?: boolean; removed?: string } = {}) => {
  const i = oppIdx.get(o.key)!;
  tm.push({ id: U('opportunity_team_members', `${o.key}:${personKey}:${role}`), opportunity_id: U('opportunities', o.key), person_id: U('people', personKey), org62_user_id: org62User(personKey), team_role: role, is_me: !!opts.me, first_seen_at: at(-30 + (i % 7), '08:30'), last_seen_at: opts.removed ?? at(-(i % 3), '06:30'), removed_at: opts.removed ?? null });
};
OPPS.forEach((o, i) => {
  addTm(o, ownerAe(o.acct), 'Account Executive');
  if (o.mine) addTm(o, 'owner', o.seRole ?? 'Solutions Engineer', { me: true });
  else if (i % 3 !== 2) addTm(o, peers[i % 3]!, 'Solutions Engineer');
  for (const e of o.extra ?? []) addTm(o, e, e.startsWith('spec') ? 'Specialist' : e.startsWith('ptr') ? 'Partner' : e.startsWith('se-') ? 'Solutions Engineer' : e.startsWith('deskdesk') ? 'Deal Desk' : 'Team Member');
  if (o.type === 'Renewal' || o.stage === 'Closed Won' && i % 4 === 0) addTm(o, 'csm-femi', 'Customer Success Manager');
});
// one teammate removed from an opp team (history)
addTm(OPPS.find((o) => o.key === 'yarrowdale-bh-wellness')!, 'se-linnea', 'Solutions Engineer', { removed: at(-30, '07:00') });
const tmDedup = [...new Map(tm.map((r) => [`${r.opportunity_id}|${r.org62_user_id}|${r.team_role}`, r])).values()];

const base = { OWNER, T0, U, ACCOUNTS, OPPS, PEOPLE, acctIndex, oppIdx, org62User, org62Contact, internalOrder };

// ───────────────────────── users + config ─────────────────────────
const cfg = buildConfig(base);
const users: Row[] = [{ id: OWNER, email: 'rafael.okonkwo@example.com', display_name: 'Rafael Okonkwo', timezone: 'America/Denver', person_id: U('people', 'owner'), team_pack_id: U('team_packs', 'se-core'), role_template_id: U('role_templates', 'se_ic'), manager_person_id: U('people', 'mgr'), is_active: true, created_at: T0, updated_at: at(-5, '09:00') }];

writeTable('users', users); writeTable('people', people); writeTable('person_identities', identities);
writeTable('accounts', accounts); writeTable('account_aliases', aliases); writeTable('opportunities', opportunities); writeTable('opportunity_team_members', tmDedup);
for (const [t, rows] of Object.entries(cfg.tables)) writeTable(t, rows);
flushRefs('core');
writeFileSync(path.join(SAMPLE_DIR, 'CAST.md'), cfg.cast({ people: PEOPLE, tmCount: tmDedup.length, identityCount: identities.length }));
console.log('wrote CAST.md');
void NOW; void sha; void slackChannel; void slackDm;
