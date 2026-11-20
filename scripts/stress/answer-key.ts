/**
 * Independent answer key (Opus 5.5). It sees ONLY the raw recordings (rendered as a compact digest with refs)
 * plus the extraction and linking rules copied from the skills, never the scanner's output.
 *   npx tsx scripts/stress/answer-key.ts digest <block> <fromDay> <toDay>   (writes the digest, prints size)
 *   npx tsx scripts/stress/answer-key.ts run <block>                        (Opus pass → answer-key/<block>.json)
 * Refs: S:<channel>:<ts> (Slack) · G:<gmailId> · C:<eventId> · N:<docId> (Gemini notes) · D:<fileId> (Drive)
 *       · CS:<sessionId> · O:<Sobject>:<Id>.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { parseDriveSearch, parseEvents, parseGmailBatch } from '../../src/connectors/google/parse';

import { runAgent } from './lib/agent';
import { assertBudget, recordSpend } from './lib/ledger';
import { privDir, readJson, writePriv } from './lib/paths';
import { loadProfile } from './lib/profile';
import { dayBounds } from './lib/time';
import type { GoogleRecording } from './record/google';
import type { TranscriptIndex } from './replay/claude';
import { tsMs, type SlackIndex } from './replay/slack';
import type { SoqlTable } from './replay/soql';

const MODEL = 'claude-opus-5-5';

export interface KeyItem {
  key: string;
  kind: 'ask' | 'commitment' | 'follow_up' | 'training' | 'task' | 'deliverable';
  title: string;
  confidence?: 'sure' | 'likely' | 'guess';
  handedOff?: boolean;
  refs: Array<{ ref: string; role: 'origin' | 'progress' | 'completion' | 'context' | 'contradiction'; note?: string }>;
}

export interface AnswerKey {
  block: string;
  from: string;
  to: string;
  items: KeyItem[];
  missedMeetings?: Array<{ ref: string; title: string }>;
  notes?: string;
}

const clip = (s: string | undefined, n: number) => {
  const t = (s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};
const hm = (ms: number) => new Date(ms).toLocaleString('en-US', { timeZone: 'America/Denver', weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });

export function buildDigest(fromDay: string, toDay: string): string {
  const from = Date.parse(dayBounds(fromDay).from);
  const to = Date.parse(dayBounds(toDay).to);
  const prof = loadProfile();
  const root = privDir('recordings');
  const out: string[] = [];
  const watched = new Set(prof.channels.filter((c) => c.watch).map((c) => c.id));
  const customer = new Map(prof.channels.filter((c) => c.account).map((c) => [c.id, c.account!]));

  // ---- Slack
  const ix = readJson<SlackIndex>(path.join(root, 'slack', 'index.json'));
  const msgs = Object.values(ix.messages)
    .filter((m) => tsMs(m.ts) >= from && tsMs(m.ts) < to)
    .filter((m) => {
      const inbox = m.classes.some((c) => c === 'dm' || c === 'mentions' || c === 'mine');
      const cust = customer.has(m.channelId);
      const threadOfMine = !!m.threadTs && Object.values(ix.messages).some((p) => p.channelId === m.channelId && p.ts === m.threadTs && p.classes.includes('mine'));
      if (watched.has(m.channelId)) return inbox;
      return inbox || cust || threadOfMine;
    })
    .sort((a, b) => tsMs(a.ts) - tsMs(b.ts));
  out.push(`## SLACK (${msgs.length} messages; me = ${prof.me.name} ${prof.me.slackId})`);
  for (const m of msgs) {
    const where = (m.channelLine ?? m.channelId).replace(/ \(ID: [A-Z0-9]+\)$/, '');
    const dmWith = /^(DM|Group DM)/.test(where) ? ` [${clip(m.participantsLine?.replace(/ \(ID: [A-Z0-9]+\)/g, ''), 120)}]` : '';
    const acct = customer.get(m.channelId) ? ` {account: ${customer.get(m.channelId)}}` : '';
    const thread = m.threadTs ? ` ↳reply in thread S:${m.channelId}:${m.threadTs}` : '';
    const me = m.authorId === prof.me.slackId ? ' (ME)' : '';
    out.push(`[S:${m.channelId}:${m.ts}] ${hm(tsMs(m.ts))} ${m.authorName ?? '?'}${me} in ${where}${dmWith}${acct}${thread}: ${clip(m.text, 700)}`);
  }

  // ---- Gmail
  const g = readJson<GoogleRecording>(path.join(root, 'google', 'recording.json'));
  const mails = Object.values(g.gmail.messages)
    .filter((m) => m.dateMs && m.dateMs >= from && m.dateMs < to && m.block)
    .sort((a, b) => a.dateMs! - b.dateMs!);
  out.push(`\n## GMAIL (${mails.length} messages)`);
  for (const m of mails) {
    const [p] = parseGmailBatch(m.block!);
    if (!p) continue;
    const sent = m.bases.some((b) => b.startsWith('in:sent'));
    const training = m.bases.some((b) => !b.startsWith('in:'));
    const bulk = /no-?reply|noreply|notifications?@|mailer|newsletter/i.test(p.from);
    out.push(`[G:${m.id}] ${hm(m.dateMs!)} ${sent ? 'SENT BY ME' : 'received'}${training ? ' (training-query match)' : ''} thread=${m.threadId ?? '-'} From: ${clip(p.from, 80)} To: ${clip(p.to, 120)}${p.cc ? ` Cc: ${clip(p.cc, 80)}` : ''} Subject: ${clip(p.subject, 140)}\n    ${clip(p.body, bulk ? 250 : 1100)}`);
  }

  // ---- Calendar
  const evs = parseEvents(g.calendar.blocks.join('\n')).filter((e) => Date.parse(e.start) >= from && Date.parse(e.start) < to && !e.allDay);
  out.push(`\n## CALENDAR (${evs.length} events; my response from the attendee list)`);
  for (const e of evs) {
    const mine = e.attendees.find((a) => a.email === prof.me.email.toLowerCase());
    out.push(`[C:${e.id}] ${hm(Date.parse(e.start))}–${hm(Date.parse(e.end)).slice(-5)} "${clip(e.title, 120)}" my=${mine ? `${mine.response}${mine.organizer ? ' organizer' : ''}` : 'not on list'} attendees=${e.attendees.length} link=${e.meetingLink ? 'yes' : 'no'}${e.attachments.length ? ` attachments=${e.attachments.map((a) => clip(a.title, 60)).join('; ')}` : ''}${e.description ? `\n    ${clip(e.description, 300)}` : ''}`);
  }

  // ---- Gemini notes + Drive
  const rows = g.drive.rows.map((l) => parseDriveSearch(l).files[0]!);
  const notes = rows.filter((r) => /notes by gemini/i.test(r.name) && Date.parse(r.created ?? r.modified) >= from && Date.parse(r.created ?? r.modified) < to);
  out.push(`\n## GEMINI MEETING NOTES (${notes.length} docs; summary + next steps)`);
  for (const r of notes) {
    const c = g.drive.content[r.id];
    const md = c?.text ?? '';
    const ns = md.search(/next steps/i);
    const summary = md.search(/summary/i);
    const body = `${summary >= 0 ? clip(md.slice(summary, summary + 1200), 1200) : ''} … ${ns >= 0 ? clip(md.slice(ns, ns + 1800), 1800) : '(no next steps section)'}`;
    out.push(`[N:${r.id}] created ${hm(Date.parse(r.created ?? r.modified))} "${clip(r.name, 140)}"\n    ${body}`);
  }
  const me = prof.me.email.toLowerCase();
  const edits = rows.filter((r) => r.lastEditedByEmail === me && Date.parse(r.modified) >= from && Date.parse(r.modified) < to && !/notes by gemini/i.test(r.name));
  out.push(`\n## DRIVE FILES I EDITED (${edits.length}; current names; content diffs are not available)`);
  for (const r of edits) out.push(`[D:${r.id}] modified ${hm(Date.parse(r.modified))} "${clip(r.name, 140)}" (${r.mimeType.split('.').pop()})`);

  // ---- Claude sessions (first prompt per session active in the block)
  const ci = readJson<TranscriptIndex>(path.join(root, 'claude', 'index.json'), { files: [] });
  const sess: string[] = [];
  for (const f of ci.files) {
    const first = f.marks[0]?.[1] ?? 0;
    const last = f.marks[f.marks.length - 1]?.[1] ?? 0;
    if (last < from || first >= to) continue;
    let prompt = '';
    try {
      const fd = fs.openSync(path.join(os.homedir(), '.claude', 'projects', f.rel), 'r');
      const buf = Buffer.alloc(Math.min(f.size, 200_000));
      fs.readSync(fd, buf, 0, buf.length, 0);
      fs.closeSync(fd);
      for (const line of buf.toString('utf8').split('\n')) {
        if (!line.includes('"type":"user"')) continue;
        const j = JSON.parse(line) as { message?: { content?: unknown } };
        const c = j.message?.content;
        prompt = typeof c === 'string' ? c : Array.isArray(c) ? String((c.find((x: { type?: string }) => x.type === 'text') as { text?: string } | undefined)?.text ?? '') : '';
        if (prompt && !prompt.startsWith('<')) break;
      }
    } catch {
      /* unreadable */
    }
    const proj = f.rel.split('/')[0]!.replace(/^-Users-[^-]+-[^-]+-/, '');
    sess.push(`[CS:${path.basename(f.rel, '.jsonl')}] ${hm(first)} → ${hm(last)} project=${clip(proj, 60)}: ${clip(prompt, 300)}`);
  }
  out.push(`\n## CLAUDE CODE SESSIONS (${sess.length})`, ...sess);

  // ---- Org62
  const t = readJson<Record<string, SoqlTable>>(path.join(root, 'org62', 'tables.json'), {});
  const inBlock = (v: unknown) => typeof v === 'string' && Date.parse(v.replace(/\+0000$/, 'Z')) >= from && Date.parse(v.replace(/\+0000$/, 'Z')) < to;
  const evRows = (t.Event?.rows ?? []).filter((r) => inBlock(r.StartDateTime) || inBlock(r.SystemModstamp));
  out.push(`\n## ORG62 MY EVENTS (${evRows.length}; logged activity)`);
  for (const r of evRows) out.push(`[O:Event:${String(r.Id)}] start ${String(r.StartDateTime)} subject="${clip(String(r.Subject ?? ''), 100)}" what=${clip(String((r.What as { Name?: string } | null)?.Name ?? ''), 80)} type=${String(r.SE_Task_Type__c ?? '')} modified ${String(r.SystemModstamp)}`);
  const opps = (t.OpportunityTeamMember?.rows ?? []).filter((r) => inBlock(r.SystemModstamp) || inBlock((r.Opportunity as { SystemModstamp?: string } | null)?.SystemModstamp));
  out.push(`\n## ORG62 MY OPP TEAMS CHANGED (${opps.length}; values are as of today)`);
  for (const r of opps) {
    const o = r.Opportunity as Record<string, unknown>;
    out.push(`[O:Opportunity:${String(r.OpportunityId)}] "${clip(String(o?.Name ?? ''), 100)}" stage=${String(o?.StageName)} close=${String(o?.CloseDate)} next="${clip(String(o?.NextStep ?? ''), 120)}" role=${String(r.TeamMemberRole)}`);
  }
  const dcs = (t.Deal_Contribution__c?.rows ?? []).filter((r) => r.SE_Name__c === prof.me.org62UserId && inBlock(r.SystemModstamp));
  out.push(`\n## ORG62 MY DEAL CONTRIBUTIONS CHANGED (${dcs.length})`);
  for (const r of dcs) out.push(`[O:Deal_Contribution__c:${String(r.Id)}] opp="${clip(String((r.Opportunity__r as { Name?: string } | null)?.Name ?? ''), 100)}" role=${String(r.Opportunity_Role__c)} split=${String(r.Split_Percentage__c)}`);
  return out.join('\n');
}

function section(md: string, re: RegExp): string {
  const at = md.search(re);
  if (at < 0) return '';
  const rest = md.slice(at);
  const next = rest.slice(3).search(/^## /m);
  return next < 0 ? rest : rest.slice(0, next + 3);
}

export function rulesText(): string {
  const common = fs.readFileSync('skills/_scanner-common.md', 'utf8');
  const parts = [section(common, /^## R4\./m), section(common, /^## R5\./m), section(common, /^## R7\./m), section(common, /^## R8\./m)];
  for (const s of ['slack', 'gmail', 'calendar', 'gemini-notes', 'drive', 'claude-sessions', 'trainings', 'org62']) {
    const md = fs.readFileSync(`skills/scan-${s}.md`, 'utf8');
    parts.push(`### scan-${s}: extraction rules\n${section(md, /^## \d+\. Extraction rules/m)}`);
  }
  return parts.join('\n\n');
}

const INSTRUCTIONS = `You are building an ANSWER KEY to grade an automated scanner. You see the raw source data of a personal-ops cockpit user ("me") and the rules the scanner must follow. List what a careful human assistant applying those rules would extract. Be precise and conservative: only real asks of me, my commitments, completion signals, requirement changes after done, meeting takeaways assigned to me, trainings I must complete, and missed meetings. Do NOT invent items for noise (greetings, FYIs, bots, newsletters, broadcasts, other people's tasks).

Group evidence into ITEMS: one item per distinct deliverable/ask/commitment. The SAME item seen in several sources or several days (an ask in Slack, the deck emailed later, the Gemini next step, a Drive edit) is ONE item with several refs. That cross-source grouping is the most important part.

For each item give: key (short unique slug), kind (ask | commitment | follow_up | training | task | deliverable), title (verb + deliverable + person/account, ≤ 12 words), confidence (sure | likely | guess, per R8), handedOff (true if I handed it to someone or I'm only a watcher), and refs: each {ref, role, note}. Roles: origin (where the ask/commitment/takeaway first appears), progress, completion (my delivery: "sent", "done", a link, the email with the attachment, a logged Org62 event closing a "log activity" item), contradiction (new requirements after it was done; note "requirements_change: …"), context (relevant FYI; a handed-off item's updates; a loop-back gets role origin with note "loop_back: …").

Also list missedMeetings: calendar events that look like real meetings I was expected at but did not accept/attend (needsAction/declined/not on list where relevant), as {ref, title}.

Use ONLY refs that appear in the data, copied exactly (e.g. "S:C0ABC:1793800000.000100", "G:19a1b2c3", "C:abc123", "N:1x2y", "O:Event:00U…"). Output ONLY one JSON object: {"items":[...],"missedMeetings":[...],"notes":"<≤3 sentences on ambiguous cases>"} — no prose before or after.`;

async function main() {
  const [cmd, block, a, b] = process.argv.slice(2);
  const dir = privDir('answer-key');
  if (cmd === 'digest') {
    const d = buildDigest(a!, b!);
    writePriv(path.join(dir, `${block}.digest.txt`), d);
    writePriv(path.join(dir, `${block}.meta.json`), JSON.stringify({ block, from: a, to: b }));
    console.log(`digest ${block}: ${d.length} chars (~${Math.round(d.length / 3.6 / 1000)}K tokens), ${d.split('\n').filter((l) => l.startsWith('[')).length} refs`);
    return;
  }
  if (cmd === 'run') {
    const digest = fs.readFileSync(path.join(dir, `${block}.digest.txt`), 'utf8');
    const meta = readJson<{ from: string; to: string }>(path.join(dir, `${block}.meta.json`));
    const prof = loadProfile();
    const estimate = (digest.length / 3.6 / 1e6) * 4 + 0.6;
    assertBudget(estimate);
    const r = await runAgent({
      model: MODEL,
      effort: 'high',
      maxTurns: 2,
      timeoutMs: 1_500_000,
      systemPrompt: `${INSTRUCTIONS}\n\n# Rules (copied from the scanner skills)\n\n${rulesText()}`,
      prompt: `# Me\n${prof.me.name} <${prof.me.email}>, Slack ${prof.me.slackId}, Org62 ${prof.me.org62UserId}, time zone ${prof.timezone}.\nMy accounts: ${prof.accounts.map((x) => x.name).join('; ')}.\nCustomer channels: ${prof.channels.filter((c) => c.account).map((c) => `${c.name} → ${c.account}`).join('; ')}. Watched (briefs only): ${prof.channels.filter((c) => c.watch).map((c) => c.name).join(', ')}.\n\n# Data: ${meta.from} → ${meta.to} (local days)\n\n${digest}\n\nNow output the JSON answer key.`,
    });
    recordSpend({ scenario: `answer-key:${block}`, kind: 'answer_key', model: MODEL, costUsd: r.costUsd, note: `${r.inputTokens} in / ${r.outputTokens} out` });
    const text = r.text.trim();
    const json = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
    let key: AnswerKey;
    try {
      key = { block: block!, from: meta.from, to: meta.to, ...(JSON.parse(json) as Omit<AnswerKey, 'block' | 'from' | 'to'>) };
    } catch (e) {
      writePriv(path.join(dir, `${block}.raw.txt`), r.text);
      throw new Error(`answer key ${block}: unparseable JSON (${(e as Error).message}); raw saved. ok=${r.ok} err=${r.error ?? ''}`);
    }
    writePriv(path.join(dir, `${block}.json`), JSON.stringify(key, null, 1));
    const kinds: Record<string, number> = {};
    for (const it of key.items) kinds[it.kind] = (kinds[it.kind] ?? 0) + 1;
    const cross = key.items.filter((it) => new Set(it.refs.map((x) => x.ref.split(':')[0])).size > 1).length;
    console.log(`answer key ${block}: ${key.items.length} items ${JSON.stringify(kinds)}, cross-source=${cross}, missed meetings=${key.missedMeetings?.length ?? 0}; cost $${r.costUsd.toFixed(3)} (${r.inputTokens} in / ${r.outputTokens} out)`);
  }
}

const invoked = /answer-key\.ts$/.test(process.argv[1] ?? '');
if (invoked) {
  main().catch((e) => {
    console.error((e as Error).message);
    process.exit(1);
  });
}
