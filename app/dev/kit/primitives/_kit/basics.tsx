'use client';
/** Kit: buttons, keys, badges, chips, icons. */
import { useEffect, useState } from 'react';
import {
  Button,
  ConfidenceWord,
  ContextChip,
  CountBadge,
  EffortSplit,
  EntityChip,
  Eyebrow,
  Icon,
  IconButton,
  Kbd,
  KbdHint,
  ObjectTile,
  SourceChip,
  StaleMark,
  StartBy,
  StatePill,
  type ButtonSize,
  type ButtonVariant,
  type EntityKind,
  type SourceKind,
  type Tone,
} from '@/ui';
import { Cell, KitSection, Specimen } from './frame';

const VARIANTS: ButtonVariant[] = ['primary', 'secondary', 'ghost', 'danger', 'ai'];
const SIZES: ButtonSize[] = ['xs', 'sm', 'md'];
const TONES: Tone[] = ['ok', 'warn', 'risk', 'brand', 'neutral', 'ai'];
const SOURCES: SourceKind[] = ['slack', 'gmail', 'calendar', 'drive', 'gemini', 'org62', 'vdp', 'claude', 'manual'];
const ENTITIES: Array<[EntityKind, string]> = [
  ['account', 'ACME Corp'],
  ['opp', 'ACME · DC expansion FY27'],
  ['initiative', 'Headless Phase 2 demo'],
  ['person', 'Dana Reyes'],
  ['session', 'Demo gap notes'],
  ['file', 'ACME Phase 2 deck'],
];

export function ButtonsSection() {
  const [pressed, setPressed] = useState(false);
  return (
    <KitSection id="buttons" eyebrow="Actions" title="Buttons" intro="Pill, 13 px regular. One solid primary per card or view; the ai variant carries exactly one sparkle.">
      {SIZES.map((size) => (
        <Specimen key={size} label={`size="${size}"`} note={size === 'md' ? '32 px · comfortable 36' : size === 'sm' ? '28 px' : '24 px'}>
          {VARIANTS.map((v) => (
            <Button key={v} variant={v} size={size}>
              {v === 'primary' ? 'Send' : v === 'secondary' ? 'Edit' : v === 'ghost' ? 'Snooze' : v === 'danger' ? 'Discard' : 'Regenerate'}
            </Button>
          ))}
        </Specimen>
      ))}
      <Specimen label="With key hint" note="kbd displays only; bind with useKeyBinding">
        <Button variant="primary" kbd="mod+enter">
          Send
        </Button>
        <Button variant="secondary" kbd="e">
          Edit
        </Button>
        <Button variant="ghost" kbd="s">
          Snooze
        </Button>
        <Button variant="ai" kbd="mod+/">
          Shorter
        </Button>
      </Specimen>
      <Specimen label="With icon">
        <Button variant="primary" icon="send">
          Approve and send
        </Button>
        <Button variant="secondary" icon="agent_session">
          Start in Claude
        </Button>
        <Button variant="secondary" iconRight="new_window">
          Open in Slack
        </Button>
      </Specimen>
      <Specimen label="Loading · disabled">
        <Button variant="primary" loading>
          Sending
        </Button>
        <Button variant="secondary" loading>
          Saving
        </Button>
        <Button variant="primary" disabled>
          Send
        </Button>
        <Button variant="secondary" disabled>
          Edit
        </Button>
        <Button variant="ai" disabled>
          Apply
        </Button>
      </Specimen>
      <Specimen label="IconButton" note="ghost · header · outline · solid; badge; pressed">
        {SIZES.map((s) => (
          <IconButton key={s} icon="settings" label={`Settings ${s}`} size={s} />
        ))}
        <IconButton icon="notification" label="Notifications" variant="header" badge={3} />
        <IconButton icon="chat" label="New activity" badge />
        <IconButton icon="add" label="Add" variant="outline" size="sm" />
        <IconButton icon="send" label="Send" variant="solid" size="sm" />
        <IconButton icon="pin" label="Pin" pressed={pressed} onClick={() => setPressed((v) => !v)} />
        <IconButton icon="refresh" label="Refreshing" loading />
        <IconButton icon="close" label="Disabled" disabled />
      </Specimen>
      <Specimen label="Kbd · KbdHint" note="mono is reserved for keys">
        <Kbd>Esc</Kbd>
        <KbdHint combo="mod+k" />
        <KbdHint combo="mod+shift+c" />
        <KbdHint combo="shift+enter" />
        <KbdHint combo="g h" />
        <KbdHint combo="j|k" />
        <KbdHint combo="?" />
        <span className="rounded-md bg-ink-600 px-2 py-1">
          <KbdHint combo="z" tone="inverse" />
        </span>
      </Specimen>
    </KitSection>
  );
}

const WORK_STATES: Array<{ tone: Tone; label: string; dashed?: boolean; note: string }> = [
  { tone: 'ai', label: 'Suggested', dashed: true, note: 'suggested' },
  { tone: 'brand', label: 'In progress', note: 'in_progress' },
  { tone: 'warn', label: 'Waiting on you', note: 'waiting_on_me' },
  { tone: 'neutral', label: 'Waiting on Dana · 3d', note: 'waiting_on_others' },
  { tone: 'ai', label: 'Likely done · Confirm', note: 'likely_done' },
  { tone: 'ok', label: 'Done by you', note: 'done' },
  { tone: 'ok', label: 'Handed off → Dana', note: 'done (handed_off)' },
  { tone: 'warn', label: 'Reopened', note: 'reopened' },
  { tone: 'neutral', label: 'Snoozed until Mon 09:00', note: 'snoozed' },
];

export function BadgesSection() {
  // Client-only clock (no SSR/hydration mismatch on relative times).
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => setNow(new Date()), []);
  const at = (min: number) => new Date((now?.getTime() ?? 0) + min * 60_000).toISOString();
  return (
    <KitSection id="badges" eyebrow="Status" title="StatePill, counts, confidence, effort, timing" intro="Badges are 4 px (not interactive). Tint 50 with text 700 keeps ≈ 6:1 contrast.">
      {(['xs', 'sm', 'md'] as const).map((size) => (
        <Specimen key={size} label={`StatePill ${size}`}>
          {TONES.map((t) => (
            <StatePill key={t} tone={t} size={size} label={t} />
          ))}
        </Specimen>
      ))}
      <Specimen label="dot · dashed · icon">
        {TONES.map((t) => (
          <StatePill key={t} tone={t} dot label={`${t} dot`} />
        ))}
        <StatePill tone="brand" dashed label="Pending approval" />
        <StatePill tone="ai" dashed label="Suggested" />
        <StatePill tone="ok" icon="check" label="Verified in Slack" />
        <StatePill tone="risk" icon="error" label="Send failed" />
      </Specimen>
      <Specimen label="Work-state vocabulary" note="UI-SPEC §11">
        {WORK_STATES.map((s) => (
          <Cell key={s.note} label={s.note}>
            <StatePill tone={s.tone} label={s.label} dashed={s.dashed} />
          </Cell>
        ))}
      </Specimen>
      <Specimen label="CountBadge" note="brand = must act · risk = overdue · neutral = reading">
        <CountBadge count={4} />
        <CountBadge count={12} tone="risk" />
        <CountBadge count={3} tone="neutral" />
        <CountBadge count={140} />
      </Specimen>
      <Specimen label="Eyebrow">
        <Eyebrow count={2}>Waiting on you</Eyebrow>
        <Eyebrow count={5}>Closed for you</Eyebrow>
        <Eyebrow tone="ai">Proposed change</Eyebrow>
        <Eyebrow tone="brand">Draft · Slack</Eyebrow>
      </Specimen>
      <Specimen label="ConfidenceWord" note="a word, never a %">
        <ConfidenceWord value="sure" />
        <ConfidenceWord value="likely" />
        <ConfidenceWord value="guess" />
      </Specimen>
      <Specimen label="EffortSplit">
        <EffortSplit youMin={10} agentMin={100} />
        <EffortSplit youMin={5} />
        <EffortSplit youMin={45} agentMin={0} />
      </Specimen>
      <Specimen label="StartBy" note="warn ≤ 15 min · risk when late">
        {now ? (
          <>
        <Cell label="in 2h">
          <StartBy at={at(120)} now={now} />
        </Cell>
        <Cell label="in 10m">
          <StartBy at={at(10)} now={now} />
        </Cell>
        <Cell label="late">
          <StartBy at={at(-25)} now={now} />
        </Cell>
        <Cell label="emphasis (#1 card)">
          <StartBy at={at(95)} now={now} emphasis />
        </Cell>
          </>
        ) : null}
      </Specimen>
      <Specimen label="StaleMark">
        <span className="inline-flex items-center gap-2 text-body">
          Reply to Dana: confirm scope <StaleMark reason="Gmail needs re-auth since 09:40; this may be out of date." />
        </span>
        <StaleMark reason="Slack is catching up (60%).">behind</StaleMark>
      </Specimen>
    </KitSection>
  );
}

export function ChipsSection() {
  const [ctx, setCtx] = useState(['Reply to Dana: confirm scope', 'ACME Corp']);
  return (
    <KitSection id="chips" eyebrow="References" title="SourceChip, EntityChip, ContextChip" intro="Linked chips are pills (interactive). Letter avatars only; no third-party favicon fetches.">
      <Specimen label="SourceChip" note="plain">
        {SOURCES.map((s) => (
          <SourceChip key={s} source={s} />
        ))}
      </Specimen>
      <Specimen label="SourceChip" note="href (opens source)">
        <SourceChip source="slack" label="#acme-ext · thread" href="https://example.com/slack" />
        <SourceChip source="gmail" label="Dana Reyes · Re: scope" href="https://example.com/mail" />
        <SourceChip source="drive" label="Deck 'ACME Phase 2'" href="https://example.com/deck" />
        <SourceChip source="org62" label="Opp · DC expansion" href="/deals" />
      </Specimen>
      <Specimen label="SourceChip" note="compact (row density)">
        {SOURCES.map((s) => (
          <SourceChip key={s} source={s} compact href={s === 'manual' ? undefined : '/'} />
        ))}
      </Specimen>
      <Specimen label="EntityChip">
        {ENTITIES.map(([k, l]) => (
          <EntityChip key={k} kind={k} label={l} />
        ))}
      </Specimen>
      <Specimen label="EntityChip" note="href · compact">
        {ENTITIES.map(([k, l]) => (
          <EntityChip key={k} kind={k} label={l} href="/deals" />
        ))}
        {ENTITIES.map(([k, l]) => (
          <EntityChip key={`${k}-c`} kind={k} label={l} href="/deals" compact />
        ))}
      </Specimen>
      <Specimen label="ContextChip" note="chat context; removable">
        {ctx.map((c, i) => (
          <ContextChip key={c} label={c} kind={i === 1 ? 'account' : undefined} icon={i === 0 ? 'task' : undefined} onRemove={() => setCtx((p) => p.filter((x) => x !== c))} />
        ))}
        <ContextChip label="Today" icon="home" />
        {ctx.length < 2 ? (
          <Button size="xs" variant="ghost" onClick={() => setCtx(['Reply to Dana: confirm scope', 'ACME Corp'])}>
            Reset
          </Button>
        ) : null}
      </Specimen>
    </KitSection>
  );
}

const ICON_MAP: Array<[string, string]> = [
  ['apps', 'App launcher'],
  ['search', 'Search'],
  ['add', 'Global actions'],
  ['record_create', 'Capture'],
  ['notification', 'Notifications'],
  ['question_mark', 'Help'],
  ['shortcuts', 'Shortcuts'],
  ['settings', 'Settings'],
  ['connected_apps', 'Health'],
  ['sync', 'Sync'],
  ['offline', 'Offline'],
  ['sparkles', 'AI (one per element)'],
  ['slack', 'Slack'],
  ['email', 'Gmail'],
  ['event', 'Meeting'],
  ['summary', 'Gemini notes'],
  ['salesforce1', 'Org62'],
  ['knowledge_base', 'VDP'],
  ['agent_session', 'Claude session'],
  ['trailhead', 'Training'],
  ['clock', 'Effort / snooze'],
  ['waits', 'Waiting'],
  ['check', 'Done'],
  ['undo', 'Undo'],
  ['warning', 'Warning'],
  ['error', 'Error'],
  ['send', 'Send'],
  ['lock', 'Dry run'],
  ['priority', 'Priority'],
  ['new_window', 'Open source'],
  ['money', 'Spend'],
  ['data_cloud', 'Data / D360'],
];

export function IconsSection() {
  return (
    <KitSection id="icons" eyebrow="Iconography" title="Icon (SLDS sprites)" intro="@salesforce-ux/icons 10.18.1 · CC BY-ND 4.0 · glyphs unmodified. Utility glyphs take currentColor.">
      <Specimen label="Sizes" note="xs 12 · sm 14 · md 16 · lg 20 · xl 24">
        {(['xs', 'sm', 'md', 'lg', 'xl'] as const).map((s) => (
          <Cell key={s} label={s}>
            <Icon name="sparkles" size={s} className="text-ai-700" />
          </Cell>
        ))}
      </Specimen>
      <Specimen label="Icon map" note="brief 12 §7.3">
        <div className="grid w-full grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-x-3 gap-y-2">
          {ICON_MAP.map(([n, l]) => (
            <span key={n} className="flex items-center gap-2 text-caption text-muted" title={`utility:${n}`}>
              <Icon name={n} size="md" className="text-fg" />
              <span className="truncate">{l}</span>
            </span>
          ))}
        </div>
      </Specimen>
      <Specimen label="ObjectTile" note="standard sprite on SLDS identity colours">
        {['account', 'opportunity', 'event', 'task', 'email', 'user', 'report', 'timesheet', 'data_cloud'].map((n) => (
          <Cell key={n} label={n}>
            <ObjectTile name={n} />
          </Cell>
        ))}
      </Specimen>
      <Specimen label="Doctype">
        {['gdoc', 'gsheet', 'gpres', 'folder', 'pdf', 'slack_canvas'].map((n) => (
          <Cell key={n} label={n}>
            <Icon set="doctype" name={n} size="xl" />
          </Cell>
        ))}
      </Specimen>
    </KitSection>
  );
}
