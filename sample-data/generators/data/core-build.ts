/** Builds every config/policy/settings table of domain 01 and the CAST.md text. Called by ../01-core.ts. */
import { at, addMinutes, day, NOW, sfId, slackChannel, slackDm, uid, type Row } from '../../lib/kit';
import { CAPTURE_RULES, CF_SWAP, FISCAL, INTERESTS, INTERNAL_DOWNGRADE, PICKLISTS, RULES_BASE, RULES_V3_EXTRA, TASK_TYPES, TEAM_PACK_RAW, W_V1, W_V2, W_V3, packHash, slug, type RuleDef } from './core-config';
import type { AccountDef, OppDef } from './core-deals';
import type { PersonDef } from './core-people';

type Ctx = {
  OWNER: string; T0: string; U: (t: string, k: string | number) => string; ACCOUNTS: AccountDef[]; OPPS: OppDef[]; PEOPLE: PersonDef[];
  acctIndex: Map<string, number>; oppIdx: Map<string, number>; org62User: (k: string) => string; org62Contact: (k: string) => string; internalOrder: string[];
};
const cs = (n: number) => uid('change_sets', n); // domain 03 guarantees change_sets 1..500
const CHANGE_SETS_USED = [2, 3, 22, 23, 40, 49, 64, 74, 83, 90, 96, 121, 131, 142, 167, 175, 188, 203];

export function buildConfig(c: Ctx) {
  const { OWNER, T0, U, ACCOUNTS } = c;
  const t: Record<string, Row[]> = {};
  const oppId = (k: string) => U('opportunities', k);

  // ── team pack, task types, picklists, fiscal periods, role templates, team rules ──
  const packId = U('team_packs', 'se-core');
  const hash = packHash();
  t.team_packs = [{ id: packId, slug: 'se-core', version: '1', name: 'Solutions Engineering Team Pack', source_path: 'config/team-packs/se-core.json', content_hash: hash, raw: TEAM_PACK_RAW(hash), loaded_at: T0, created_at: T0 }];
  const tt = (n: string) => U('se_task_types', slug(n));
  t.se_task_types = TASK_TYPES.map((x, i) => ({ id: tt(x.name), team_pack_id: packId, name: x.name, counts_customer_related: x.cr, counts_customer_facing: x.cf, bucket: x.bucket, external_swap_to_id: CF_SWAP[x.name] ? tt(CF_SWAP[x.name]!) : null, internal_downgrade_to_id: INTERNAL_DOWNGRADE[x.name] ? tt(INTERNAL_DOWNGRADE[x.name]!) : null, requires_meeting_type: !!x.mt, is_active: true, ordinal: i }));
  t.org62_picklist_values = PICKLISTS.flatMap(([field, vals]) => vals.map((value, i) => ({ id: U('org62_picklist_values', `${field}:${value}`), team_pack_id: packId, field, value, is_active: !(field === 'StageName' && value === 'Prospecting'), ordinal: i })));
  t.fiscal_periods = FISCAL.map((f) => ({ id: U('fiscal_periods', `fy${f.fy}q${f.q}`), team_pack_id: packId, name: `FY${String(f.fy).slice(2)} Q${f.q}`, fiscal_year: f.fy, fiscal_quarter: f.q, starts_on: f.start, ends_on: f.end, logging_deadline_at: f.deadline ? new Date(f.deadline).toISOString() : null, deadline_assumed: f.assumed, deadline_note: f.note, hours_target: 250 }));

  const seedWeights = { customer_facing: 2, meeting_proximity: 1.5, due_urgency: 1.5, manager_ask: 1.5, deal_value: 1, lead_time: 1, age: 0.6, effort_fit: 0.8 };
  const seedRules = RULES_BASE.map((r) => ({ id: r.key, text: r.label, enabled: true, when: r.cond, boost: r.value }));
  t.role_templates = [
    { id: U('role_templates', 'se_ic'), team_pack_id: packId, key: 'se_ic', version: '1', name: 'Solutions Engineer (individual contributor)', description: 'Customer meetings, demos, POCs and blueprints; logs Solutions Events; claims deal contributions; keeps VDPs current.', priority_policy_seed: { id: 'se_ic', name: 'SE priorities', role: 'se_ic', weights: seedWeights, rules: seedRules, top3Size: 3 }, agent_preference_seed: { captureRules: CAPTURE_RULES.map((r) => r.key), autonomy: { slack_reply: 'L1', email_reply: 'L1', canvas_rewrite: 'L1', tool_launch: 'L0' }, voice: { tone: 'crisp', length: 'short' }, watch: { channelAsks: 'ask', meetingCatchUps: false } }, created_at: T0 },
    { id: U('role_templates', 'se_manager'), team_pack_id: packId, key: 'se_manager', version: '1', name: 'Solutions Engineering manager', description: 'Team coverage, deal reviews, forecast calls; lighter customer prep.', priority_policy_seed: { id: 'se_manager', name: 'SE manager priorities', role: 'se_manager', weights: { ...seedWeights, manager_ask: 1, deal_value: 2 }, rules: seedRules.slice(0, 2), top3Size: 3 }, agent_preference_seed: { captureRules: ['promises', 'direct_asks'], autonomy: { slack_reply: 'L1', email_reply: 'L1' }, voice: { tone: 'warm', length: 'medium' }, watch: { channelAsks: 'ask' } }, created_at: T0 },
    { id: U('role_templates', 'ae_ic'), team_pack_id: null, key: 'ae_ic', version: '1', name: 'Account Executive (individual contributor)', description: 'Forecast hygiene, customer follow-ups, mutual action plans.', priority_policy_seed: { id: 'ae_ic', name: 'AE priorities', role: 'ae', weights: { ...seedWeights, deal_value: 3 }, rules: seedRules.slice(0, 1), top3Size: 3 }, agent_preference_seed: { captureRules: ['promises', 'direct_asks'], autonomy: { email_reply: 'L1' }, voice: { tone: 'warm', length: 'medium' }, watch: { channelAsks: 'mine' } }, created_at: T0 },
  ];
  t.team_rules = [
    { key: 'weekly-log-friday', kind: 'recurring_task', schedule: 'FRI 15:00 America/Denver', params: { title: "Log this week's Solutions Events", durationMin: 30, customerFacing: false } },
    { key: 'quarter-logging-deadline', kind: 'deadline_task', schedule: null, params: { title: 'Finish logging the quarter in Org62', offsetDaysBeforeDeadline: 3, hoursTarget: 250 } },
    { key: 'monthly-vdp-review', kind: 'recurring_task', schedule: 'MON-1 10:00 America/Denver', params: { title: 'Review VDP completeness for engaged opportunities', durationMin: 45 } },
    { key: 'missed-dc-sweep', kind: 'coverage_check', schedule: 'WED 08:00 America/Denver', params: { sweep: 'missed_opps', minAmountUsd: 50000, lookbackDays: 30 } },
    { key: 'overlaps-policy', kind: 'logging_rule', schedule: null, params: { overlaps: 'log_all_accepted', roundTo: 0.25 } },
    { key: 'cf-swap', kind: 'classification_rule', schedule: null, params: { externalAttendee: 'force_customer_facing_type', swaps: CF_SWAP } },
    { key: 'internal-downgrade', kind: 'classification_rule', schedule: null, params: { internalOnly: 'never_customer_facing_type', downgrades: INTERNAL_DOWNGRADE } },
  ].map((r) => ({ id: U('team_rules', r.key), team_pack_id: packId, key: r.key, kind: r.kind, schedule: r.schedule, params: r.params, enabled: true }));

  // ── channels ──
  type Ch = { key: string; name: string | null; kind: string; watch: string; cust: boolean; member?: boolean; archived?: boolean; ext: string; acct?: string };
  const CH: Ch[] = [
    { key: 'saltmere-poc', name: 'saltmere-poc', kind: 'shared_external', watch: 'items', cust: true, ext: slackChannel(1), acct: 'saltmere' },
    { key: 'saltmere-team', name: 'saltmere-team', kind: 'private', watch: 'items', cust: false, ext: slackChannel(2), acct: 'saltmere' },
    { key: 'elderglen-outdoors-deal', name: 'elderglen-outdoors-deal', kind: 'private', watch: 'items', cust: false, ext: slackChannel(3), acct: 'elderglen-outdoors' },
    { key: 'elderglen-outdoors-ext', name: 'elderglen-outdoors-ext', kind: 'shared_external', watch: 'items', cust: true, ext: slackChannel(4), acct: 'elderglen-outdoors' },
    { key: 'yarrowdale-team', name: 'yarrowdale-team', kind: 'private', watch: 'items', cust: false, ext: slackChannel(5), acct: 'yarrowdale' },
    { key: 'halvergate-freight', name: 'halvergate-freight', kind: 'private', watch: 'items', cust: false, ext: slackChannel(6), acct: 'halvergate' },
    { key: 'se-team', name: 'se-team', kind: 'public', watch: 'items', cust: false, ext: slackChannel(7) },
    { key: 'se-demo-requests', name: 'se-demo-requests', kind: 'public', watch: 'digest', cust: false, ext: slackChannel(8) },
    { key: 'data-ai-specialists', name: 'data-ai-specialists', kind: 'public', watch: 'digest', cust: false, ext: slackChannel(9) },
    { key: 'company-announcements', name: 'company-announcements', kind: 'public', watch: 'ignore', cust: false, ext: slackChannel(10) },
    { key: 'deal-desk-help', name: 'deal-desk-help', kind: 'public', watch: 'digest', cust: false, ext: slackChannel(11) },
    { key: 'industry-news', name: 'industry-news', kind: 'public', watch: 'ignore', cust: false, ext: slackChannel(12) },
    { key: 'cascadia-onsite', name: 'cascadia-onsite', kind: 'private', watch: 'items', cust: false, ext: slackChannel(13), acct: 'cascadia' },
    { key: 'ferrowpay-pursuit', name: 'ferrowpay-pursuit', kind: 'private', watch: 'items', cust: false, ext: slackChannel(14), acct: 'ferrowpay' },
    { key: 'oakhallow-pursuit-2025', name: 'oakhallow-pursuit-2025', kind: 'private', watch: 'digest', cust: false, member: false, archived: true, ext: slackChannel(15), acct: 'oakhallow' },
    { key: 'cc-feedback', name: 'cc-feedback', kind: 'public', watch: 'digest', cust: false, ext: slackChannel(16) },
    { key: 'contoso-marketplace', name: 'contoso-marketplace', kind: 'shared_external', watch: 'digest', cust: true, ext: slackChannel(17), acct: 'contoso' },
    { key: 'voltmere-account', name: 'voltmere-account', kind: 'public', watch: 'digest', cust: false, ext: slackChannel(18), acct: 'voltmere' },
    { key: 'dm-mgr', name: null, kind: 'dm', watch: 'items', cust: false, ext: slackDm(1) },
    { key: 'dm-ae-harbor', name: null, kind: 'dm', watch: 'items', cust: false, ext: slackDm(2) },
    { key: 'dm-ae-commercial', name: null, kind: 'dm', watch: 'items', cust: false, ext: slackDm(3) },
    { key: 'gdm-harbor-team', name: 'mpdm-theo.brandt--hana.lindqvist--rafael.okonkwo-1', kind: 'group_dm', watch: 'items', cust: false, ext: slackDm(4) },
  ];
  t.channels = CH.map((x, i) => ({ id: U('channels', x.key), owner_user_id: OWNER, system: 'slack', external_id: x.ext, name: x.name, kind: x.kind, watch_mode: x.watch, is_customer_channel: x.cust, is_member: x.member ?? true, archived_at: x.archived ? at(-20, '10:00') : null, created_at: addMinutes(T0, 20 + i), updated_at: addMinutes(T0, 20 + i) }));

  // ── mapping rules ──
  type MR = { key: string; kind: string; pattern: string; regex?: boolean; acct?: string; opp?: string; person?: string; task?: string; source: string; cs?: number; hits: number; note?: string; enabled?: boolean };
  const MRS: MR[] = [
    ...ACCOUNTS.flatMap((a) => a.domains.map((d): MR => ({ key: `dom-${a.key}`, kind: 'domain_to_account', pattern: d, acct: a.key, source: a.key === 'yarrowdale-bh' ? 'user_correction' : 'seed', cs: a.key === 'yarrowdale-bh' ? 74 : undefined, hits: 20 + ((c.acctIndex.get(a.key)! * 7) % 60), note: a.key === 'yarrowdale-bh' ? 'Was matching the parent; split out after the VDP company-identity review.' : undefined }))),
    { key: 'chan-saltmere', kind: 'channel_to_account', pattern: '^saltmere-', regex: true, acct: 'saltmere', source: 'llm_suggested', hits: 88, note: 'Accepted from a suggestion after the first week.' },
    { key: 'chan-elderglen-outdoors', kind: 'channel_to_account', pattern: '^elderglen-outdoors-', regex: true, acct: 'elderglen-outdoors', source: 'user_correction', cs: 96, hits: 54 },
    { key: 'chan-oakhallow-old', kind: 'channel_to_account', pattern: 'oakhallow-pursuit-2025', acct: 'oakhallow', source: 'seed', hits: 3, enabled: false, note: 'Channel archived; rule left disabled.' },
    { key: 'repo-saltmere', kind: 'repo_path_to_account', pattern: 'saltmere-poc-demo', acct: 'saltmere', source: 'user_correction', cs: 121, hits: 17 },
    { key: 'repo-ferrowpay', kind: 'repo_path_to_account', pattern: 'ferrowpay-fraud', acct: 'ferrowpay', source: 'llm_suggested', hits: 6 },
    { key: 'title-saltmere-poc', kind: 'title_token_to_account', pattern: 'Saltmere POC', acct: 'saltmere', opp: 'saltmere-data360-poc', source: 'user_correction', cs: 83, hits: 41 },
    { key: 'title-tod-renewal', kind: 'title_token_to_account', pattern: 'TOD renewal', acct: 'elderglen-outdoors', opp: 'elderglen-outdoors-renewal-expansion', source: 'user_correction', cs: 203, hits: 9 },
    { key: 'sender-mari-q', kind: 'sender_to_person', pattern: 'mari.q@saltmere-health.example', person: 'hv-marisol', source: 'user_correction', cs: 142, hits: 4, note: 'Identity merge: the alternate address belongs to Marisol Quintero.' },
    { key: 'kw-dry-run', kind: 'keyword_to_task_type', pattern: 'dry run', task: 'Dry Run', source: 'team_pack', hits: 12 },
    { key: 'kw-workshop', kind: 'keyword_to_task_type', pattern: 'workshop', task: 'Workshop', source: 'team_pack', hits: 8 },
    { key: 'kw-sizing', kind: 'keyword_to_task_type', pattern: '(sizing|consumption estimate)', regex: true, task: 'Consumption Estimation', source: 'user_correction', cs: 167, hits: 11 },
    { key: 'kw-1on1', kind: 'keyword_to_task_type', pattern: '1:1 with Hana', task: 'Mentorship', source: 'user_correction', cs: 175, hits: 5 },
    { key: 'meet-saltmere-sync', kind: 'meeting_to_opportunity', pattern: 'Saltmere weekly sync', acct: 'saltmere', opp: 'saltmere-data360-poc', source: 'user_correction', cs: 90, hits: 9 },
    { key: 'meet-cascadia-onsite', kind: 'meeting_to_opportunity', pattern: 'Cascadia workshop', acct: 'cascadia', opp: 'cascadia-citizen-assistant', source: 'llm_suggested', hits: 2 },
    { key: 'ign-sender-digest', kind: 'ignore_sender', pattern: 'digest@industry-news.example', source: 'user_correction', cs: 49, hits: 31 },
    { key: 'ign-sender-bot', kind: 'ignore_sender', pattern: 'noreply@travel-portal.example', source: 'seed', hits: 7, note: 'Bulk travel notices; real confirmations still arrive from the booking sender.' },
    { key: 'ign-chan-announce', kind: 'ignore_channel', pattern: 'company-announcements', source: 'user_correction', cs: 22, hits: 140 },
    { key: 'ign-chan-news', kind: 'ignore_channel', pattern: 'industry-news', source: 'user_correction', cs: 23, hits: 96 },
  ];
  const mrId = (k: string) => U('mapping_rules', k);
  t.mapping_rules = MRS.map((m, i) => ({ id: mrId(m.key), owner_user_id: OWNER, kind: m.kind, pattern: m.pattern, is_regex: !!m.regex, account_id: m.acct ? U('accounts', m.acct) : null, opportunity_id: m.opp ? oppId(m.opp) : null, person_id: m.person ? U('people', m.person) : null, se_task_type_id: m.task ? tt(m.task) : null, target_value: null, priority: m.kind.startsWith('ignore') ? 10 : 100 - (i % 5), source: m.source, created_from_change_set_id: m.cs ? cs(m.cs) : null, hit_count: m.hits, last_hit_at: m.hits ? at(-(i % 6), '11:05') : null, enabled: m.enabled ?? true, note: m.note ?? null, created_at: m.cs ? at(-28 + (i % 24), '12:00') : T0, updated_at: at(-(i % 8), '12:00') }));

  // ── channel_account_maps ──
  const CAM: Array<[string, string, string | null, string, number, string | null, string | null]> = [
    ['saltmere-poc', 'saltmere', 'saltmere-data360-poc', 'user', 1, null, 'confirmed'],
    ['saltmere-team', 'saltmere', null, 'rule', 0.95, 'chan-saltmere', null],
    ['elderglen-outdoors-deal', 'elderglen-outdoors', 'elderglen-outdoors-renewal-expansion', 'rule', 0.95, 'chan-elderglen-outdoors', 'confirmed'],
    ['elderglen-outdoors-ext', 'elderglen-outdoors', null, 'rule', 0.95, 'chan-elderglen-outdoors', null],
    ['yarrowdale-team', 'yarrowdale', 'yarrowdale-enterprise-data', 'llm', 0.78, null, 'confirmed'],
    ['yarrowdale-team', 'yarrowdale-mg', null, 'llm', 0.52, null, 'rejected'],
    ['halvergate-freight', 'halvergate', 'halvergate-route-exceptions-agent', 'connector', 0.9, null, null],
    ['cascadia-onsite', 'cascadia', 'cascadia-citizen-assistant', 'user', 1, null, 'confirmed'],
    ['ferrowpay-pursuit', 'ferrowpay', 'ferrowpay-data360-foundation', 'llm', 0.82, null, null],
    ['oakhallow-pursuit-2025', 'oakhallow', null, 'rule', 0.9, 'chan-oakhallow-old', null],
    ['contoso-marketplace', 'contoso', null, 'connector', 0.92, null, null],
    ['voltmere-account', 'voltmere', null, 'llm', 0.7, null, null],
    ['se-demo-requests', 'elderglen-outdoors', null, 'llm', 0.45, null, 'rejected'],
  ];
  t.channel_account_maps = CAM.map(([ch, a, o, method, conf, rule, verdict], i) => ({ id: U('channel_account_maps', `${ch}:${a}`), channel_id: U('channels', ch), account_id: U('accounts', a), opportunity_id: o ? oppId(o) : null, method, confidence: conf, mapping_rule_id: rule ? mrId(rule) : null, user_verdict: verdict, created_at: addMinutes(T0, 60 + i), updated_at: at(-(i % 9), '13:00') }));

  // ── connectors ──
  const RO = {
    slack: ['slack_read_channel', 'slack_read_thread', 'slack_search_public_and_private', 'slack_search_users', 'slack_read_user_profile', 'slack_search_channels', 'slack_read_canvas'],
    gmail: ['search_threads', 'get_thread', 'get_message', 'list_labels'],
    drive: ['search_files', 'read_file_content', 'get_file_metadata', 'list_recent_files'],
    calendar: ['list_events', 'get_event', 'list_calendars', 'search_events'],
    gemini: ['search_files', 'read_file_content'],
    org62: ['soqlQuery', 'find', 'getObjectSchema', 'getRelatedRecords', 'getUserInfo'],
    claude: ['read_sessions_dir'],
    vdp: ['list_vdps', 'get_vdp', 'search_companies', 'list_assets', 'get_server_info'],
  };
  type Cn = { key: string; kind: string; name: string; transport: string; config: Row; allow: string[]; status?: string; reason?: string | null; err?: string | null; errAt?: string | null; fails?: number; stale?: number; expires?: string | null; lastOk?: string };
  const CN: Cn[] = [
    { key: 'slack', kind: 'slack', name: 'Slack', transport: 'mcp_http', config: { label: 'Slack (workspace)' }, allow: RO.slack, status: 'degraded', reason: 'Slack: rate limited (429), backing off', err: 'rate_limited', errAt: at(0, '08:41'), fails: 2, stale: 900, lastOk: at(0, '08:30') },
    { key: 'gmail-work', kind: 'gmail', name: 'Gmail (work)', transport: 'mcp_http', config: { label: 'Work mailbox' }, allow: RO.gmail },
    { key: 'gmail-shared', kind: 'gmail', name: 'Gmail (customer alias)', transport: 'mcp_http', config: { label: 'Shared customer alias' }, allow: RO.gmail },
    { key: 'drive', kind: 'drive', name: 'Drive', transport: 'mcp_http', config: { label: 'Google Drive', reauth: { command: null, instructions: 'Reconnect Google Drive in the connector settings and approve read access.', kind: 'manual_instructions', label: 'Reconnect Drive' } }, allow: RO.drive, errAt: at(-4, '14:10'), err: 'auth' },
    { key: 'calendar', kind: 'calendar', name: 'Calendar', transport: 'mcp_http', config: { label: 'Google Calendar' }, allow: RO.calendar },
    { key: 'gemini-notes', kind: 'gemini_notes', name: 'Gemini notes', transport: 'agent_sdk', config: { label: 'Meeting notes in Drive' }, allow: RO.gemini },
    { key: 'org62', kind: 'org62', name: 'Org62', transport: 'mcp_http', config: { label: 'Org62 (read only)' }, allow: RO.org62 },
    { key: 'claude', kind: 'claude', name: 'Claude sessions', transport: 'local_files', config: { label: 'Local Claude session logs' }, allow: RO.claude },
    { key: 'vdp', kind: 'vdp', name: 'VDP', transport: 'agent_sdk', config: { label: 'VDP plans', reauth: { command: 'python3 ~/scripts/refresh_vdp_cookie.py', instructions: null, kind: 'refresh_script', label: 'Run refresh' } }, allow: RO.vdp, err: 'auth', errAt: at(0, '08:12'), expires: addMinutes(NOW, 48), lastOk: at(0, '08:30') },
  ];
  t.connectors = CN.map((x, i) => ({ id: U('connectors', x.key), owner_user_id: OWNER, kind: x.kind, name: x.name, transport: x.transport, config: x.config, read_tool_allowlist: x.allow, enabled: true, status: x.status ?? 'healthy', status_reason: x.reason ?? null, status_changed_at: x.status ? at(0, '08:41') : at(-(1 + (i % 4)), '07:00'), last_success_at: x.lastOk ?? at(0, '08:5' + (i % 6)), last_error_at: x.errAt ?? null, last_error_code: x.err ?? null, consecutive_failures: x.fails ?? 0, stale_after_seconds: x.stale ?? (x.kind === 'org62' ? 7200 : 3600), auth_expires_at: x.expires ?? null, created_at: T0, updated_at: at(0, '08:45') }));

  // ── priority policies ──
  const wcols = (w: typeof W_V1) => ({ weight_deadline_proximity: w.dl, weight_calendar_pressure: w.cal, weight_lead_time: w.lead, weight_effort_fit: w.eff, weight_stakeholder_importance: w.stake, weight_deal_value: w.deal, weight_commitment: w.commit, weight_staleness: w.stale, weight_obligation: w.oblig });
  const pol = (k: string) => U('priority_policies', k);
  t.priority_policies = [
    { id: pol('v1'), owner_user_id: OWNER, version: 1, status: 'retired', based_on_policy_id: null, role_template_id: U('role_templates', 'se_ic'), ...wcols(W_V1), top3_size: 3, change_summary: 'Starting point from the SE (IC) role template', source: 'role_template', change_set_id: cs(2), activated_at: T0, retired_at: at(-12, '16:05'), created_at: T0 },
    { id: pol('v2'), owner_user_id: OWNER, version: 2, status: 'retired', based_on_policy_id: pol('v1'), role_template_id: U('role_templates', 'se_ic'), ...wcols(W_V2), top3_size: 3, change_summary: 'Raised manager asks and deal value after chatting about missed asks (11/06)', source: 'chat', change_set_id: cs(64), activated_at: at(-12, '16:05'), retired_at: at(-3, '15:20'), created_at: at(-12, '16:05') },
    { id: pol('v3'), owner_user_id: OWNER, version: 3, status: 'active', based_on_policy_id: pol('v2'), role_template_id: U('role_templates', 'se_ic'), ...wcols(W_V3), top3_size: 3, change_summary: 'Added a 24h SLA for manager asks, a Now floor for customer deliverables due within 72h, and hid FYI-only noise', source: 'user', change_set_id: cs(188), activated_at: at(-3, '15:20'), retired_at: null, created_at: at(-3, '15:18') },
  ];
  const ruleRow = (p: string, r: RuleDef, i: number, src: string, val?: number): Row => ({ id: U('priority_policy_rules', `${p}:${r.key}`), policy_id: pol(p), ordinal: i, rule_key: r.key, label: r.label, explanation: r.expl, kind: r.kind, condition: r.cond, other_condition: r.other ?? null, effect_value: r.kind === 'boost' || r.kind === 'penalty' ? (val ?? r.value) : null, effect_lane: r.lane ?? null, sla_hours: r.sla ?? null, enabled: r.enabled ?? true, source: src, created_at: p === 'v1' ? T0 : p === 'v2' ? at(-12, '16:05') : at(-3, '15:18') });
  t.priority_policy_rules = [
    ...RULES_BASE.map((r, i) => ruleRow('v1', r, i, 'role_template')),
    ...RULES_BASE.map((r, i) => ruleRow('v2', r, i, i === 1 ? 'user' : 'role_template', r.key === 'r_manager' ? 4 : undefined)),
    ...[...RULES_BASE, ...RULES_V3_EXTRA].map((r, i) => ruleRow('v3', r, i, i >= 3 || i === 1 ? 'user' : 'role_template', r.key === 'r_manager' ? 4 : undefined)),
  ];

  // ── voice, autonomy, capture rules, interests ──
  t.voice_profiles = [
    { id: U('voice_profiles', 'v1'), owner_user_id: OWNER, version: 1, status: 'retired', source: 'role_template', tone: 'crisp', formality: 3, verbosity: 2, emoji_use: 0, greeting: 'Hi {first},', signoff: 'Thanks,\nRafael', phrases_to_use: [], phrases_to_avoid: [], style_guide: 'Short, direct, no filler.', slack_guide: null, email_guide: null, learned_from_message_count: 0, change_summary: 'Default SE voice', change_set_id: cs(3), activated_at: T0, created_at: T0 },
    { id: U('voice_profiles', 'v2'), owner_user_id: OWNER, version: 2, status: 'retired', source: 'learned', tone: 'crisp', formality: 2, verbosity: 2, emoji_use: 1, greeting: 'Hi {first},', signoff: 'Thanks,\nRafael', phrases_to_use: ['happy to jump on a call', 'quick one'], phrases_to_avoid: ['circle back', 'synergy'], style_guide: 'Answer first, then context. One ask per message.', slack_guide: 'Lowercase, brief, a thumbs-up emoji is fine.', email_guide: 'Plain paragraphs, no bullet lists under 3 items.', learned_from_message_count: 96, change_summary: 'Learned from 96 sent messages in the first scan', change_set_id: cs(40), activated_at: at(-24, '10:00'), created_at: at(-24, '10:00') },
    { id: U('voice_profiles', 'v3'), owner_user_id: OWNER, version: 3, status: 'active', source: 'user', tone: 'crisp', formality: 2, verbosity: 2, emoji_use: 1, greeting: 'Hi {first},', signoff: 'Thanks,\nRafael', phrases_to_use: ['happy to jump on a call', 'quick one', 'here is where I landed'], phrases_to_avoid: ['circle back', 'synergy', 'per my last email'], style_guide: 'Answer first, then context. One ask per message. Name the date when something is due.', slack_guide: 'Lowercase, brief; reply in thread; one emoji at most.', email_guide: 'Plain paragraphs, no bullet lists under 3 items; customers get a clear next step and a date.', learned_from_message_count: 142, change_summary: 'Added "here is where I landed" and banned "per my last email" (edited by hand)', change_set_id: cs(131), activated_at: at(-9, '09:30'), created_at: at(-9, '09:30') },
  ];
  const AP: Array<[string, string, string | null, string]> = [
    ['slack_message', 'L1_draft', null, 'Slack posts always draft first.'],
    ['slack_reply', 'L1_draft', null, 'Replies draft first; I approve each one.'],
    ['email_message', 'L1_draft', null, 'Email stays a draft in Gmail.'],
    ['email_reply', 'L1_draft', null, 'Same for replies.'],
    ['vdp_update', 'L2_stage', null, 'VDP changes are staged in the Outbox for one click.'],
    ['org62_activity_batch', 'L2_stage', null, 'Time logging goes through the logging canvas.'],
    ['org62_deal_contribution', 'L1_draft', null, 'DC claims always need my click.'],
    ['canvas_rewrite', 'L3_one_click', 'F0SMPL001', 'The shared logging canvas can be rewritten with one click.'],
    ['calendar_hold', 'L1_draft', null, 'Holds are suggestions only.'],
    ['handoff', 'L0_suggest', null, 'Handing work to others: suggest only.'],
  ];
  t.autonomy_policies = AP.map(([a, l, tgt, note], i) => ({ id: U('autonomy_policies', `${a}:${tgt ?? 'all'}`), owner_user_id: OWNER, action_type: a, level: l, target_external_id: tgt, note, set_by_user_at: at(-20 + i, '09:00'), created_at: at(-20 + i, '09:00'), updated_at: at(-20 + i, '09:00') }));
  t.task_capture_rules = CAPTURE_RULES.map((r, i) => ({ id: U('task_capture_rules', r.key), owner_user_id: OWNER, rule_key: r.key, label: r.label, explanation: r.expl, source_scope: r.scope, condition: r.cond, action: r.action, min_confidence: r.min, target_kind: r.target, ordinal: i, enabled: true, source: i < 3 ? 'role_template' : i === 6 ? 'user' : 'team_pack', created_at: T0, updated_at: T0 }));
  t.user_interests = INTERESTS.map(([kind, value, weight, source], i) => ({ id: U('user_interests', `${kind}:${value}`), owner_user_id: OWNER, kind, value, weight, source, created_at: addMinutes(T0, 120 + i) }));

  // ── repos ──
  t.repos = ([
    ['/Users/rafael/Projects/saltmere-poc-demo', 'saltmere-poc-demo', 'https://example.com/git/se-team/saltmere-poc-demo.git', 'customer', 'saltmere', false],
    ['/Users/rafael/Projects/ferrowpay-fraud-agent', 'ferrowpay-fraud-agent', 'https://example.com/git/se-team/ferrowpay-fraud-agent.git', 'customer', 'ferrowpay', false],
    ['/Users/rafael/Projects/shared-demo-kit', 'shared-demo-kit', 'https://example.com/git/se-team/shared-demo-kit.git', 'demo_shared', null, false],
    ['/Users/rafael/Projects/control-center', 'control-center', 'https://example.com/git/rafael/control-center.git', 'tool', null, false],
    ['/Users/rafael/Projects/se-notes', 'se-notes', null, 'internal', null, false],
    ['/Users/rafael/Projects/scratch', 'scratch', null, 'unknown', null, true],
  ] as Array<[string, string, string | null, string, string | null, boolean]>).map(([path, name, remote, kind, acct, ignored], i) => ({ id: U('repos', name), owner_user_id: OWNER, path, name, remote_url: remote, kind, default_account_id: acct ? U('accounts', acct) : null, ignored, created_at: addMinutes(T0, 200 + i), updated_at: addMinutes(T0, 200 + i) }));

  // ── use cases: Org62 records, reads, app links ──
  type UC = { key: string; opp: string; name: string; product: string; stage: string; golive: string | null; vdp: string; slug: string; origin: string; syncedStage?: string };
  const UCS: UC[] = [
    { key: 'hv-member-agent', opp: 'saltmere-data360-poc', name: 'Member Services Virtual Agent', product: 'Agentforce', stage: 'U02 - Scoped', golive: '2027-03-15', vdp: 'vdp-uc-smpl-001', slug: 'saltmere-health-plan-data-360-poc', origin: 'adopted', syncedStage: 'U02 - Scoped' },
    { key: 'hv-claims-status', opp: 'saltmere-data360-poc', name: 'Claims Status Lookup', product: 'Agentforce', stage: 'U01 - Not Started', golive: null, vdp: 'vdp-uc-smpl-002', slug: 'saltmere-health-plan-data-360-poc', origin: 'adopted', syncedStage: 'U01 - Not Started' },
    { key: 'hv-unified-profile', opp: 'saltmere-data360-poc', name: 'Unified Member Profile', product: 'Data 360', stage: 'U01 - Not Started', golive: '2027-02-01', vdp: 'vdp-uc-smpl-003', slug: 'saltmere-health-plan-data-360-poc', origin: 'created', syncedStage: 'U01 - Not Started' },
    { key: 'aw-data-foundation', opp: 'yarrowdale-enterprise-data', name: 'Enterprise Patient Data Foundation', product: 'Data 360', stage: 'U01 - Not Started', golive: null, vdp: 'vdp-uc-smpl-004', slug: 'yarrowdale-health-system-enterprise-data', origin: 'adopted' },
    { key: 'qp-fraud-triage', opp: 'ferrowpay-fraud-agent', name: 'Fraud Case Triage', product: 'Agentforce', stage: 'U02 - Scoped', golive: '2027-04-30', vdp: 'vdp-uc-smpl-005', slug: 'ferrowpay-financial-fraud-agent', origin: 'adopted' },
    { key: 'qp-customer-360', opp: 'ferrowpay-data360-foundation', name: 'Customer 360 for Risk', product: 'Data 360', stage: 'U01 - Not Started', golive: null, vdp: 'vdp-uc-smpl-006', slug: 'ferrowpay-financial-data-360-foundation', origin: 'adopted' },
    { key: 'pc-claims-triage', opp: 'oakhallow-claims-agent', name: 'Claims Triage Agent', product: 'Agentforce', stage: 'U03 - In Development', golive: '2026-12-15', vdp: 'vdp-uc-smpl-007', slug: 'oakhallow-mutual-claims-agent', origin: 'adopted', syncedStage: 'U02 - Scoped' },
    { key: 'to-renewal-agent', opp: 'elderglen-outdoors-renewal-expansion', name: 'Order Status Agent', product: 'Agentforce', stage: 'U01 - Not Started', golive: null, vdp: 'vdp-uc-smpl-008', slug: 'elderglen-outdoors-expansion', origin: 'created' },
    { key: 'cc-citizen-assistant', opp: 'cascadia-citizen-assistant', name: 'Citizen Services Assistant', product: 'Agentforce', stage: 'U01 - Not Started', golive: '2027-06-01', vdp: 'vdp-uc-smpl-009', slug: 'cascadia-county-citizen-assistant', origin: 'adopted' },
    { key: 'pc-pilot-live', opp: 'oakhallow-agentforce-pilot', name: 'Policy FAQ Agent (pilot)', product: 'Agentforce', stage: 'U04 - Live', golive: '2026-10-20', vdp: 'vdp-uc-smpl-010', slug: 'oakhallow-mutual-agentforce-pilot', origin: 'adopted', syncedStage: 'U04 - Live' },
  ];
  const acctOfOpp = (k: string) => c.OPPS.find((o) => o.key === k)!.acct;
  const ucId = (k: string) => sfId('a1X', UCS.findIndex((u) => u.key === k) + 1);
  const oppSf = (k: string) => sfId('006', c.oppIdx.get(k)!);
  t.org62_use_cases = UCS.map((u, i) => ({ id: U('org62_use_cases', u.key), owner_user_id: OWNER, org62_use_case_id: ucId(u.key), org62_opportunity_id: oppSf(u.opp), org62_account_id: sfId('001', c.acctIndex.get(acctOfOpp(u.opp))!), name: u.name, product: u.product, stage: u.stage, go_live_date: u.golive, owner_org62_id: c.org62User('owner'), created_by_org62_id: c.org62User('owner'), org62_created_at: at(-28 + i, '11:00'), org62_modified_at: at(-(i % 8), '09:30'), vdp_use_case_id: u.vdp, link_origin: u.origin, synced_stage: u.syncedStage ?? null, synced_go_live: u.golive, synced_name: u.name, linked_at: at(-20 + i, '10:00'), first_seen_at: at(-28 + i, '12:00'), last_seen_at: at(0, '08:20'), gone_at: null, updated_at: at(0, '08:20') }));
  t.org62_use_case_reads = [{ owner_user_id: OWNER, read_at: at(0, '08:20'), opps: 10, complete: true, updated_at: at(0, '08:20') }]; // one row per owner (primary key)
  t.use_cases = UCS.map((u, i) => ({ id: U('use_cases', u.key), owner_user_id: OWNER, vdp_use_case_id: u.vdp, org62_use_case_id: ucId(u.key), vdp_slug: u.slug, title: u.name, account_id: U('accounts', acctOfOpp(u.opp)), opportunity_id: oppId(u.opp), org62_opportunity_id: oppSf(u.opp), created_at: at(-20 + i, '10:00'), updated_at: at(-(i % 7), '10:00') }));

  // ── specialist forecasts (storyline 20) ──
  const SF: string[][] = [
    ['saltmere-data360-poc', 'Best Case', 'Need security review sign-off before the POC readout.', 'Solutions: strong technical fit; two open risks (PHI de-identification, SSO).', 'Exec readout Dec 3'],
    ['yarrowdale-enterprise-data', 'Best Case', 'Waiting on the system CIO to pick a lead entity.', 'Solutions: architecture agreed; family structure unresolved.', 'Confirm legal entity'],
    ['ferrowpay-data360-foundation', 'Commit', 'Order form with deal desk; pricing approved.', 'Solutions: no technical risks left.', 'Signature call Nov 24'],
  ];
  t.specialist_forecasts = SF.map(([o, status, notes, judge, next], i) => {
    const op = c.OPPS.find((x) => x.key === o)!;
    return { id: U('specialist_forecasts', o!), owner_user_id: OWNER, org62_id: sfId('a0F', i + 1), name: `SF-${String(1040 + i).padStart(7, '0')}`, url: `https://org62.example.com/lightning/r/Specialist_Forecast__c/${sfId('a0F', i + 1)}/view`, org62_opportunity_id: oppSf(o!), opportunity_id: oppId(o!), account_id: U('accounts', op.acct), opportunity_name: op.name, account_name: ACCOUNTS.find((a) => a.key === op.acct)!.name, opp_stage: op.stage, opp_next_step: next, opp_close_date: day(op.close), notes, prev_notes: 'Prior week: ' + notes!.split(';')[0], mgr_notes: i === 0 ? 'Keep Beatrix posted on the readout date.' : null, deal_role: 'Solutions Engineer', judgement: judge, forecast_status: status, amount: op.amount, stage: op.stage, close_date: day(op.close), fiscal_quarter: 'FY27 Q4', owner_org62_id: c.org62User('spec-gustavo'), last_modified_at: at(-(1 + i), '15:40'), notes_updated_at: at(-(1 + i), '15:40'), synced_at: at(0, '08:25'), gone_at: null, pending: {}, created_at: at(-14, '09:00'), updated_at: at(-(1 + i), '15:40') };
  });

  // ── vdp_server ──
  t.vdp_server = [{ owner_user_id: OWNER, read_at: at(0, '08:12'), updated_at: at(0, '08:12'), info: {
    readAt: at(0, '08:12'),
    assetTypes: ['deck', 'doc', 'sheet', 'demo_org', 'recording', 'talk_track', 'estimate', 'link'],
    deliverableTypes: ['solution_blueprint', 'architecture_diagram', 'consumption_estimate', 'demo_script'],
    industries: [{ id: 'ind-smpl-01', name: 'Healthcare', parentId: null, slug: 'healthcare' }, { id: 'ind-smpl-02', name: 'Health Plans', parentId: 'ind-smpl-01', slug: 'health-plans' }, { id: 'ind-smpl-03', name: 'Retail', parentId: null, slug: 'retail' }, { id: 'ind-smpl-04', name: 'Financial Services', parentId: null, slug: 'financial-services' }, { id: 'ind-smpl-05', name: 'Manufacturing', parentId: null, slug: 'manufacturing' }, { id: 'ind-smpl-06', name: 'Public Sector', parentId: null, slug: 'public-sector' }, { id: 'ind-smpl-07', name: 'Energy & Utilities', parentId: null, slug: 'energy-utilities' }],
    salesSegments: [{ id: 'seg-smpl-1', label: 'Enterprise', slug: 'enterprise' }, { id: 'seg-smpl-2', label: 'Commercial', slug: 'commercial' }, { id: 'seg-smpl-3', label: 'Public Sector', slug: 'public-sector' }],
    companies: [{ at: at(-3, '10:00'), query: 'Saltmere', matches: [{ id: 'co-smpl-001', name: 'Saltmere Health Plan' }] }, { at: at(-3, '10:01'), query: 'Yarrowdale Behavioral', matches: [{ id: 'co-smpl-002', name: 'Yarrowdale Health System' }] }],
    tools: [{ name: 'list_vdps', args: ['owner', 'status'], required: [] }, { name: 'get_vdp', args: ['id'], required: ['id'] }, { name: 'search_companies', args: ['query'], required: ['query'] }, { name: 'list_assets', args: ['vdpId', 'type'], required: ['vdpId'] }, { name: 'get_server_info', args: [], required: [] }],
  } }];

  // ── user_settings ──
  const s = (key: string, value: unknown, when: string): Row => ({ owner_user_id: OWNER, key, value, updated_at: when });
  const dl = new Date(FISCAL[4]!.deadline!).toISOString();
  const hierId = (n: number) => sfId('001', n).slice(0, 15);
  const nodes: Record<string, { id: string; name: string; parentId: string | null }> = {};
  for (const a of ACCOUNTS) nodes[hierId(c.acctIndex.get(a.key)!)] = { id: hierId(c.acctIndex.get(a.key)!), name: a.name, parentId: a.parent ? hierId(c.acctIndex.get(a.parent)!) : a.key === 'elderglen' ? hierId(101) : a.key === 'yarrowdale' ? hierId(102) : null };
  nodes[hierId(101)] = { id: hierId(101), name: 'Elderglen Capital Partners', parentId: null };
  nodes[hierId(102)] = { id: hierId(102), name: 'Yarrowdale Health Partners', parentId: null };
  const extOpps = ['saltmere-data360-poc', 'elderglen-outdoors-renewal-expansion', 'yarrowdale-enterprise-data', 'ferrowpay-data360-foundation', 'oakhallow-claims-agent', 'halvergate-route-exceptions-agent', 'cascadia-citizen-assistant', 'saltmere-care-mgmt', 'elderglen-outdoors-marketing', 'oakhallow-agentforce-pilot'];
  t.user_settings = [
    s('settings.profile', { version: 2, name: 'Rafael Okonkwo', email: 'rafael.okonkwo@example.com', role: 'se_ic', timezone: 'America/Denver', workingHours: { start: '07:30', end: '17:30', days: [1, 2, 3, 4, 5] }, managerName: 'Hana Lindqvist' }, at(-29, '10:00')),
    s('settings.agentBehavior', { version: 3, voice: { samples: ['quick one: can you confirm the SSO group names before Thursday?', 'Thanks Marisol, here is where I landed: we keep the member profile in Data 360 and call Agentforce for the status lookup.', 'happy to jump on a call, does tomorrow 2pm work?'], style: 'crisp' }, autonomy: { slack_reply: 'L1', slack_message: 'L1', email_reply: 'L1', email_message: 'L1', canvas_rewrite: 'L3', tool_launch: 'L0' }, taskCapture: CAPTURE_RULES.slice(0, 5).map((r) => r.label), watchedSources: ['slack:#saltmere-poc', 'slack:#elderglen-outdoors-ext', 'slack:#halvergate-freight', 'gmail:customer alias', 'drive:Saltmere folder'], drafting: { tone: 'crisp', length: 'short', signoff: 'Rafael' } }, at(-9, '09:30')),
    s('settings.sending', { version: 4, defaultMode: 'draft', dryRun: false, verifyReadback: true, undoWindowSec: 10, channels: { slack: { mode: 'draft' }, gmail: { mode: 'draft' }, vdp: { mode: 'send', autopilot: false, dailyCap: 40 }, slack_canvas: { mode: 'send' } } }, at(-14, '11:20')),
    s('settings.budgets', { version: 6, softUsd: 15, hardUsd: 25, alertPct: 80, readinUsdPerDay: 2, triageEscalationUsdPerDay: 1, today: null, raises: [{ day: day(-8), at: at(-8, '13:12'), fromSoftUsd: 15, toSoftUsd: 22, fromHardUsd: 25, toHardUsd: 32, reason: 'Hit the cap during the Slack backfill; need it finished' }] }, at(-8, '13:12')),
    s('settings.display', { version: 2, density: 'compact', theme: 'lightning', shortcutsEnabled: true, scheme: 'dark', textSize: 16 }, at(-27, '08:40')),
    s('settings.chat', { version: 2, defaultModel: 'sonnet', dailyUsd: 3, messageUsd: { sonnet: 0.25, opus: 0.6 }, maxSteps: 30, researchUsd: 0.5 }, at(-12, '10:30')),
    s('settings.time', { version: 3, detectOnsite: true, onsiteHours: { start: '08:00', end: '17:00' }, airportBufferMin: 60, airportBufferBeforeMin: 120, airportBufferAfterMin: 60, dinnersCustomerFacing: true, logging: { mode: 'on_demand', canvas: 'per_batch', autoAt: '17:30', approveComplete: true, sharedCanvasId: null, org62RecordTypeId: sfId('012', 1), workOrderCanvasUrl: 'https://example.com/slack/canvas/F0SMPLWORK1' }, overlaps: 'log_all_accepted' }, at(-13, '16:00')),
    s('settings.scanning', { version: 2, channelAsks: 'ask', meetingCatchUps: true, oppTeamCatchUps: false, mappingQuestions: 'mine', vdpRefreshScript: '~/scripts/refresh_vdp_cookie.py', vdpPython: '' }, at(-18, '09:15')),
    s('settings.closing', { version: 3, enabled: true, reasons: { done_by_you: 'close', resolved_by_other: 'close', moment_passed: 'close', not_yours: 'close', not_an_ask: 'close', duplicate: 'close', superseded: 'close', gone_quiet: 'ask' }, strictness: 'balanced', askFirstExternalCommitments: true, askFirstPeople: ['Beatrix Oyelaran'], askFirstChannels: ['#saltmere-poc'], rules: 'Never auto-close anything that mentions a pricing change.', reopenOnFollowUp: true, oldAskDays: 30, strongerModelForUnclear: true, strongerModelUsdPerDay: 1, tellMeWhatClosed: true }, at(-11, '14:00')),
    s('settings.persona', { version: 2, id: 'se', level: null, rules: { vdp_current: { enabled: true, text: 'Every engaged opportunity has a VDP with use cases, assets and owners; check on Mondays' } }, customRules: [{ id: 'rvp-asks', text: 'Asks from my regional VP are tasks due the same day', enabled: true }], thresholds: { missedOppMinAmountUsd: 50000 }, features: { solutionsJudgement: true }, connectors: { vdp: true } }, at(-10, '10:10')),
    s('settings.feedback', { version: 1, channelId: slackChannel(16), channelName: '#cc-feedback', postLive: true }, at(-26, '09:00')),
    s('settings.guide', { version: 3, checklistDismissed: true, seen: { 'home.ribbon': at(-30, '08:30'), 'triage.tour': at(-29, '11:00'), 'time.tour': at(-25, '10:00'), 'outbox.tour': at(-24, '10:30'), 'settings.sources': at(-30, '08:45') } }, at(-20, '16:10')),
    s('onboarding', { status: 'complete', completedAt: at(-31, '09:30'), by: 'web', firstScan: { lookbackDays: 30, budgetUsd: 100, requestedAt: at(-31, '09:30'), status: 'started', message: 'First scan started: 24 hours first, then widening to 30 days.' } }, at(-31, '09:30')),
    s('cc.meta', { schemaVersion: 1, label: 'Sample dataset (invented)', asOf: NOW, lastActiveAt: at(-1, '17:40'), timezone: 'America/Denver', user: { id: OWNER, name: 'Rafael Okonkwo', email: 'rafael.okonkwo@example.com' }, quarter: { label: 'FY27 Q4', targetH: 250, due: dl, loggedH: 38.5 }, canvas: { label: 'Logging canvas, batch of 2026-11-13', lastSyncedAt: at(-5, '16:00'), rowsChangedSince: 3 }, repoFolder: '/Users/rafael/Projects/saltmere-poc-demo', rankedAt: at(0, '07:35'), policyRankVersion: 3 }, at(0, '07:35')),
    s('cc.org62.account_hierarchy', { readAt: at(0, '06:55'), nodes, read: Object.keys(nodes) }, at(0, '06:55')),
    s('cc.vdp.autopilot', { entries: [], lastRunAt: null, paused: null, pausedSince: null }, at(-14, '11:20')),
    s('cc.deals/dc-read', { at: at(-1, '08:20'), complete: true }, at(-1, '08:20')),
    s('cc.time.dismiss-rules', { rules: [{ key: 'repo:scratch', kind: 'repo', label: 'Repo: scratch', createdAt: at(-17, '12:00') }, { key: 'docs:unmapped', kind: 'docs', label: 'Docs I cannot map to an account', createdAt: at(-15, '12:30') }] }, at(-15, '12:30')),
    ...extOpps.map((k, i) => s(`cc.ext/opportunities/${oppId(k)}`, { nextStepRead: true, org62Url: `https://org62.example.com/lightning/r/Opportunity/${oppSf(k)}/view`, ...(i % 2 === 0 ? { dcAssigned: true } : {}) }, at(-(i % 6), '08:20'))),
  ];

  return { tables: t, cast: (x: { people: PersonDef[]; tmCount: number; identityCount: number }) => castMd(c, x, { CH, CN, UCS, SF, MRS }) };
}

// ───────────────────────── CAST.md ─────────────────────────
function castMd(c: Ctx, x: { people: PersonDef[]; tmCount: number; identityCount: number }, d: { CH: Array<{ key: string; name: string | null; kind: string; watch: string; acct?: string }>; CN: Array<{ key: string; kind: string; name: string; status?: string }>; UCS: Array<{ key: string; opp: string; name: string; vdp: string; slug: string }>; SF: string[][]; MRS: Array<{ key: string }> }): string {
  const { ACCOUNTS, OPPS, PEOPLE } = c;
  const aeName = (acct: string) => PEOPLE.find((p) => p.key === ACCOUNTS.find((a) => a.key === acct)!.ae)!.name;
  const health = (o: OppDef) => (o.stage.startsWith('Closed') ? (o.stage === 'Closed Won' ? 'won' : 'lost') : o.key === 'halvergate-route-exceptions-agent' ? 'at risk (quiet)' : o.lastAct !== null && o.lastAct < -14 ? 'cooling' : o.fc === 'Commit' ? 'strong' : 'on track');
  const money = (n: number) => '$' + n.toLocaleString('en-US');
  const L: string[] = [];
  L.push('# CAST: the shared story bible (generated by sample-data/generators/01-core.ts)', '',
    'Everything is invented. Row ids are `uid(\'<table>\', \'<key>\')` from `sample-data/lib/kit.ts`; the keys below are the exact strings to pass. "Now" is Wed 2026-11-18 09:00 MST (FY27 Q4). Use the kit time helpers (`at`, `day`).', '',
    '## The owner', '',
    '- `uid(\'users\',\'owner\')` = `OWNER`. Person key `owner`: **Rafael Okonkwo**, Solutions Engineer, Data & AI; rafael.okonkwo@example.com; Slack `slackUser(1)`; Org62 user `' + c.org62User('owner') + '`; America/Denver; manager = person `mgr` (Hana Lindqvist); persona SE (IC); team pack `se-core`, role template `se_ic`.',
    '- Working hours 07:30-17:30 MT weekdays; target 250 h per quarter; logging mode on_demand with a private canvas per batch; Org62 record type `' + sfId('012', 1) + '`; work-order canvas `F0SMPLWORK1`; shared logging canvas id for the autonomy rule `F0SMPL001`.',
    '- Sending: dry run OFF, slack/gmail drafts, VDP send with autopilot OFF (cap 40), canvas send. Autonomy: all L1_draft except VDP/logging L2_stage, canvas_rewrite L3_one_click (target `F0SMPL001`), handoff L0_suggest.',
    '- Budgets: soft $15 / hard $25; on **2026-11-10** (day -8) the hard cap was hit during the Slack backfill and raised to $32 (reason in `settings.budgets.raises`); domain 03 should place the `budget_hard_cap` app event and budget-blocked llm_calls on that day.',
    '- Active policy `uid(\'priority_policies\',\'v3\')` (v1 role template, v2 via chat 11-06, v3 by user 11-15). Active voice profile `uid(\'voice_profiles\',\'v3\')`. Change sets referenced by core rows: ' + CHANGE_SETS_USED.join(', ') + ' (`uid(\'change_sets\', n)`; domain 03 should make them user/chat/system change sets of matching time and entity).', '',
    '## People (' + PEOPLE.length + ' rows; ' + x.identityCount + ' identities)', '',
    '| key | name | title | affiliation/tier | account | email | slack | flags |', '|---|---|---|---|---|---|---|---|');
  for (const p of PEOPLE) L.push(`| ${p.key} | ${p.name} | ${p.title} | ${p.aff}/${p.tier} | ${p.acct ?? ''} | ${p.email} | ${p.slack ? 'slackUser(' + p.slack + ')' : ''} | ${p.flags.join(', ')} |`);
  L.push('', 'Identity notes: every person has an `email` identity (primary); internal people also have `google` (calendar, `smpl-google-<slack n>`) and `org62_user`; customers with an Org62 contact have `org62_contact` (`003SMPL...`). Org62 user ids: ' + c.internalOrder.map((k) => `${k}=\`${c.org62User(k)}\``).join(', ') + '.',
    'Storyline 10: person `hv-mari-dup` ("Mari Q.", archived) is `merged_into_person_id` -> `hv-marisol`; the survivor holds Slack `slackUser(21)` and the alternate Slack `slackUser(39)` (handle mari.q); mapping rule `sender-mari-q` records the alternate email. Person `ext-tobias` (Slack `slackUser(38)`, example.org email) has no account.', '',
    '## Accounts (' + ACCOUNTS.length + ')', '', '| key | name | industry | family / parent | size | my book | watched | AE | story |', '|---|---|---|---|---|---|---|---|---|');
  for (const a of ACCOUNTS) L.push(`| ${a.key} | ${a.name} | ${a.industry} | ${a.family ?? ''}${a.parent ? ' / ' + a.parent : a.family ? ' / (parent)' : ''} | ${a.size} | ${a.book} | ${a.watched} | ${aeName(a.key)} | ${a.story} |`);
  L.push('', 'Org62 account ids `sfId(\'001\', n)` follow the order above (saltmere = 1). Aliases per account: name, short names, email domain, channel pattern, repo path, plus title tokens/regex where noted. Email domains: ' + ACCOUNTS.map((a) => `${a.key} \`${a.domains[0]}\``).join(', ') + '.', '',
    '## Opportunities (' + OPPS.length + '; ' + OPPS.filter((o) => !o.stage.startsWith('Closed')).length + ' open, ' + OPPS.filter((o) => o.stage === 'Closed Won').length + ' won, ' + OPPS.filter((o) => o.stage === 'Closed Lost').length + ' lost; ' + x.tmCount + ' team-member rows)', '',
    'Org62 opportunity id = `sfId(\'006\', position)` (1-based order of this table). `mine` = on_my_team (the owner is on the opp team as Solutions Engineer / Solution Engineer).', '',
    '| key | name | account | stage | amount | close | type | forecast | AE | mine | health | story |', '|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const o of OPPS) L.push(`| ${o.key} | ${o.name} | ${o.acct} | ${o.stage} | ${money(o.amount)} | ${new Date(Date.UTC(2026, 10, 18 + o.close)).toISOString().slice(0, 10)} | ${o.type} | ${o.fc} | ${aeName(o.acct)} | ${o.mine} | ${health(o)} | ${o.story ?? ''} |`);
  L.push('', '## Connectors', '', '| key | kind | name | status |', '|---|---|---|---|');
  for (const k of d.CN) L.push(`| ${k.key} | ${k.kind} | ${k.name} | ${k.status ?? 'healthy'} |`);
  L.push('', 'Slack is **degraded** (rate limited 429, since 08:41 today; storyline 8). VDP is healthy with `auth_expires_at` 48 min after now (cookie refreshed 08:12 after an auth failure; domain 03 logs `reauth_attempts`/`connector_auth_events` for it). Drive had an auth error 4 days ago and recovered. Domain 03 owns every health-check/event row.', '',
    '## Slack channels (`uid(\'channels\', key)`)', '', '| key | name | kind | watch | account |', '|---|---|---|---|---|');
  for (const h of d.CH) L.push(`| ${h.key} | ${h.name ? '#' + h.name : '(dm)'} | ${h.kind} | ${h.watch} | ${h.acct ?? ''} |`);
  L.push('', 'External ids: `slackChannel(n)` for the 18 non-DM channels in the order above (saltmere-poc=1 ... voltmere-account=18, cc-feedback=16), `slackDm(1..4)` for dm-mgr, dm-ae-harbor, dm-ae-commercial, gdm-harbor-team. Channel-to-account maps exist for each account channel; two are user-rejected (`se-demo-requests` -> elderglen-outdoors, `yarrowdale-team` -> yarrowdale-mg).', '',
    '## Use cases (Org62 `org62_use_cases` + app `use_cases`)', '', '| key | opp | name | vdp_use_case_id | vdp_slug |', '|---|---|---|---|---|');
  for (const u of d.UCS) L.push(`| ${u.key} | ${u.opp} | ${u.name} | ${u.vdp} | ${u.slug} |`);
  L.push('', 'Domain 02 `vdp_records`/candidates should use these slugs and `vdp-uc-smpl-NNN` ids so they join. The Saltmere VDP (`saltmere-health-plan-data-360-poc`) must be missing assets/owners (storyline 1). Org62 use-case ids are `sfId(\'a1X\', n)` in table order.', '',
    '## Specialist forecasts (storyline 20)', '', 'Three rows owned by the specialist `spec-gustavo` for opps: ' + d.SF.map((s) => s[0]).join(', ') + '; ids `uid(\'specialist_forecasts\', <oppKey>)`. The owner is an SE, so this is only the "Specialist Forecast comments" view; no second persona is configured.', '',
    '## Storyline assignments (WORLD.md numbering)', '');
  const sl = (n: number, title: string, body: string) => L.push(`${n}. **${title}.** ${body}`);
  sl(1, 'Hot deal', 'Account `saltmere`, opp `saltmere-data360-poc` ($1.25M, Technical Validation, close 2026-12-12). People: champion `hv-marisol`, VP `hv-priyanka`, CIO `hv-gareth`, architect `hv-soojin`; AE `ae-harbor`; specialist `spec-gustavo`; partner `ptr-ravindra`. Channels `saltmere-poc` (shared) and `saltmere-team`. Domain 04: the work item "Solution blueprint for the Saltmere POC" due **Fri 2026-11-20** is the Friday blueprint (name its key in your report/CAST addendum), plus a security-review ask and an SSO-groups question from `hv-soojin`. Domain 02: Tue/Thu "Saltmere weekly sync" meetings with Gemini notes, VDP record `saltmere-health-plan-data-360-poc` with missing assets/owners, heavy Slack/Gmail. Domain 05: blueprint outline draft, status email to `hv-marisol`.');
  sl(2, 'Expansion demo', 'Account `elderglen-outdoors`, opp `elderglen-outdoors-renewal-expansion` (renewal $780k, Negotiation, close 2026-11-30). `ae-commercial` asks the SE in Slack (`elderglen-outdoors-deal`) for an Agentforce order-status demo for `to-brendan`; domain 04 work item (ask) + domain 05 `slack_reply` draft in status `ready`, unapproved. Customer-side `to-meiling` joins the call.');
  sl(3, 'Gone quiet', 'Account `halvergate`, opp `halvergate-route-exceptions-agent` (close date 6 days past, last activity 24 days ago); champion `ns-anjali` stopped replying; AE `ae-commercial`. Domain 04: 2-3 aging work items (overdue follow-ups) with an at-risk signal; domain 05: a nudge email draft that is expired/superseded; domain 06: shown as at risk in a brief.');
  sl(4, 'Account family', 'Families `yarrowdale` (parent `yarrowdale`, subs `yarrowdale-mg`, `yarrowdale-bh`) and `elderglen` (parent `elderglen`, subs `elderglen-outdoors`, `elderglen-home`). Mapping rules `dom-*`, aliases, `title-*`, and the user_correction that split `yarrowdale-bh` out (change set 74). Domain 02: VDP company-identity: candidates/records for the family reflect the parent-vs-subsidiary ambiguity (`yarrowdale-bh` may resolve to the parent company). Hierarchy kv: `user_settings` key `cc.org62.account_hierarchy`.');
  sl(5, 'Missed opportunity', 'Account `harrowgate`, opp `harrowgate-maintenance-agent` ($730k, **not** on my team; peer `se-tariq` is). Domain 02: Slack/Gmail/Drive/calendar/Claude evidence of the owner demoing twice and building a deck. Domain 05: a `missed_opp_findings` row (tier strong_evidence_no_dc) and a pending `deal_contribution_requests` row (role "AI + Data Architect") on a logging canvas.');
  sl(6, 'Training and travel', 'Account `cascadia`, opp `cascadia-citizen-assistant`; onsite workshop Mon-Tue **2026-11-23/24** hosted by `cc-samir`; channel `cascadia-onsite`. Domain 04: a travel work item with `work_item_travel_details` (flights, hotel, expense) and a mandatory training item due 2026-11-21. Domain 02: calendar holds (travel, onsite). Time settings: onsite 08:00-17:00, airport buffers 120/60.');
  sl(7, 'Time logging', 'Customer work on `saltmere-data360-poc`, `ferrowpay-data360-foundation`, `oakhallow-claims-agent`, `elderglen-home-personalization`; internal meetings ("SE team sync", "1:1 with Hana" -> Mentorship via rule `kw-1on1`). Domain 05: activity_entries across statuses (proposed -> verified -> logged), one `needs_input`, one deleted in Org62, one logging-canvas batch (13 Nov). Task types: `uid(\'se_task_types\', slug(name))`, e.g. `customer-discovery`, `workshop`, `dry-run`, `mentorship` (lowercase, non-alphanumerics -> `-`).');
  sl(8, 'Pipeline failures', 'Connector `slack` degraded (rate limited); connector `vdp` auth refreshed this morning; Drive auth error 4 days ago; budget hard cap day 2026-11-10; dead-lettered jobs and transient failed scan runs are domain 03.');
  sl(9, 'Auto-close then reopen', 'Domain 04: an item about `oakhallow-claims-agent` order-form paperwork closed by the engine as `done_by_me` (asset delivered; closing reasons in `settings.closing`) and reopened by a late reply from `pc-valentina` (reopen_decisions).');
  sl(10, 'Identity mess', 'See People: `hv-mari-dup` -> `hv-marisol`, and `ext-tobias` (no account; joined `saltmere-poc` or `contoso-marketplace`). Domain 02 source items should mention both identities.');
  sl(11, 'Claude sessions', 'Repos `saltmere-poc-demo` (account saltmere) and `ferrowpay-fraud-agent`; the owner builds the Saltmere demo with Claude (domain 05 claude_sessions/tool_runs/time_blocks). Repos are `uid(\'repos\', <name>)`.');
  sl(12, 'Meeting to work', 'Gemini notes for "Saltmere weekly sync" and "Yarrowdale architecture review" (`yarrowdale-enterprise-data`); action items for the owner feed extraction candidates -> change proposals -> new work items (domain 04). Meeting-to-opp rules: `meet-saltmere-sync`, `meet-cascadia-onsite`.');
  sl(13, 'Priorities', 'Policy v3 rule keys: `r_customer`, `r_manager`, `r_admin`, `r_mgr_sla`, `r_blueprint_floor`, `r_training_cap`, `r_noise_exclude` (rows `uid(\'priority_policy_rules\', \'v3:<rule_key>\')`; domain 04 `priority_score_rule_hits` should cite them). Top 3 today: Saltmere blueprint, Elderglen demo reply, Oakhallow order form.');
  sl(14, 'Briefs and watches', 'Watched accounts `voltmere` and `contoso` (not my book); watched opps `voltmere-outage-insights`, `voltmere-service-agent`, `contoso-seller-agent`; channels `voltmere-account`, `contoso-marketplace` (digest). Interests: `user_interests`.');
  sl(15, 'Chat', 'Owner asks the assistant "what is due this week"; the answer cites the Friday blueprint, the 2026-11-21 training, the Cascadia onsite prep and the Elderglen demo. A read-in of the Saltmere thread (`user_settings` key `readin/work_item/<id>`) belongs to domain 06/04.');
  sl(16, 'VDP assets', 'Candidates for `saltmere-health-plan-data-360-poc` and `ferrowpay-financial-fraud-agent` across Drive/Slack/Gmail; recordings rare. Use cases above.');
  sl(17, 'Drafts lifecycle', 'Use `saltmere`, `elderglen-outdoors`, `ferrowpay`, `halvergate`, `oakhallow` for the draft states; `autonomy_policies` defines the levels (all L1_draft except as listed).');
  sl(18, 'Noise', 'Channels `company-announcements`, `industry-news` (ignore); `se-demo-requests`, `deal-desk-help`, `data-ai-specialists`, `contoso-marketplace` (digest); ignored senders `digest@industry-news.example`, `noreply@travel-portal.example` (rules `ign-*`).');
  sl(19, 'Org62 events', 'Domain 02 `org62_events`: Solutions Events logged by the owner against these opps, one deleted remotely; picklists in `org62_picklist_values` (Meeting_Type__c CF/CR/Data Cloud Workshop/Proof of Concept, StageName, Use_Case_Stage__c, Deal_Contribution_Role__c); task types in `se_task_types`.');
  sl(20, 'Specialist view', 'Three `specialist_forecasts` rows (above). No second persona; `settings.persona.features.solutionsJudgement = true`.');
  L.push('', '## Reserved keys later domains must create', '',
    '- **opportunity_snapshots** (domain 02): for every OPEN opportunity, a row with id `uid(\'opportunity_snapshots\', \'<oppKey>:latest\')` and `opportunity_id = uid(\'opportunities\', <oppKey>)` (the newest snapshot; `opportunities.latest_snapshot_id` points at it; also in `sample-data/reservations/core.json`). Open opp keys: ' + OPPS.filter((o) => !o.stage.startsWith('Closed')).map((o) => `\`${o.key}\``).join(', ') + '. Stage, amount, close_date must match the opportunities rows.',
    '- **change_sets** (domain 03): ids 1..500 as in WORLD.md; core references: ' + CHANGE_SETS_USED.join(', ') + '.',
    '- Nothing else is reserved.', '',
    '## Misc facts', '',
    '- Fiscal periods FY26 Q4 ... FY28 Q1 on team pack `se-core`; FY27 Q4 = 2026-11-01..2027-01-31, logging deadline 2027-02-05 (assumed); hours target 250.',
    '- Capture rule keys: `promises`, `direct_asks`, `meeting_actions`, `channel_asks`, `mandatory_training`, `newsletters`, `travel_bookings`. Team rule keys: `weekly-log-friday`, `quarter-logging-deadline`, `monthly-vdp-review`, `missed-dc-sweep`, `overlaps-policy`, `cf-swap`, `internal-downgrade`.',
    '- Mapping rules (' + d.MRS.length + ') are `uid(\'mapping_rules\', <key>)`, e.g. `title-saltmere-poc`, `meet-saltmere-sync`, `chan-elderglen-outdoors`, `dom-<accountKey>`.',
    '- `user_settings` already holds `settings.*` (12 sections), `onboarding`, `cc.meta`, `cc.org62.account_hierarchy`, `cc.vdp.autopilot`, `cc.deals/dc-read`, `cc.time.dismiss-rules` and 10 `cc.ext/opportunities/<oppId>` rows. Later domains may add other keys (`cc.ext/<table>/<id>`, `readin/...`, `cc.spend`, `cc.plan.slots`); the primary key is (owner, key).', '');
  return L.join('\n');
}
