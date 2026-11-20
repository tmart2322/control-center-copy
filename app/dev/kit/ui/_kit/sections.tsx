'use client';
/**
 * Theme-agnostic kit sections: each renders inside a `data-theme` island, so the same markup shows dark and light.
 * Placeholder data only (ACME, Dana Reyes): never real accounts or people.
 */
import { useEffect, useState } from 'react';
import {
  Banner,
  Button,
  ChangedElsewhere,
  ConfidenceWord,
  ContextChip,
  CountBadge,
  EffortSplit,
  EmptyState,
  EntityChip,
  Eyebrow,
  Icon,
  IconButton,
  InlineStatus,
  Kbd,
  KbdHint,
  LetterAvatar,
  ListContainer,
  ListGroupHeader,
  ListHeader,
  ListRow,
  ObjectTile,
  PanelError,
  RowVerb,
  SegmentedToggle,
  Skeleton,
  SourceChip,
  StaleMark,
  StartBy,
  StatePill,
  Tabs,
  type BannerTone,
  type ButtonSize,
  type ButtonVariant,
  type EntityKind,
  type Priority,
  type SourceKind,
  type Tone,
} from '@/ui';
import { Cell, Section, Specimen } from './frame';

// ── Tokens ──────────────────────────────────────────────────────────────────────────────────

const SURFACES: Array<[string, string, string]> = [
  ['bg', 'bg-bg', 'L0 canvas'],
  ['surface', 'bg-surface', 'L1 panels'],
  ['surface-raised', 'bg-surface-raised', 'L2 menus, sheet'],
  ['surface-overlay', 'bg-surface-overlay', 'L3 dialogs, ⌘K'],
  ['surface-muted', 'bg-surface-muted', 'hover on L1'],
  ['surface-sunken', 'bg-surface-sunken', 'badge, kbd'],
  ['surface-input', 'bg-surface-input', 'inputs'],
  ['selected', 'bg-selected', 'selection'],
  ['sidebar', 'bg-sidebar', 'left sidebar'],
];

const STATUS_RAMPS: Array<{ name: string; cls: [string, string, string, string, string] }> = [
  { name: 'danger', cls: ['bg-danger-50', 'bg-danger-200', 'bg-danger-500', 'bg-danger-600', 'bg-danger-700'] },
  { name: 'warning', cls: ['bg-warning-50', 'bg-warning-200', 'bg-warning-500', 'bg-warning-600', 'bg-warning-700'] },
  { name: 'success', cls: ['bg-success-50', 'bg-success-200', 'bg-success-500', 'bg-success-600', 'bg-success-700'] },
  { name: 'info', cls: ['bg-info-50', 'bg-info-200', 'bg-info-500', 'bg-info-600', 'bg-info-700'] },
  { name: 'ai', cls: ['bg-ai-50', 'bg-ai-200', 'bg-ai-500', 'bg-ai-600', 'bg-ai-700'] },
];

const CATEGORICAL: Array<[string, string, string]> = [
  ['cloud', 'bg-cloud-500', 'bg-cloud-50 text-cloud-700 border-cloud-200'],
  ['coral', 'bg-coral-500', 'bg-coral-50 text-coral-700 border-coral-200'],
  ['teal', 'bg-teal-500', 'bg-teal-50 text-teal-700 border-teal-200'],
  ['purple', 'bg-purple-500', 'bg-purple-50 text-purple-700 border-purple-200'],
  ['gold', 'bg-gold-500', 'bg-gold-50 text-gold-700 border-gold-200'],
  ['pink', 'bg-pink-500', 'bg-pink-50 text-pink-700 border-pink-200'],
  ['indigo', 'bg-indigo-500', 'bg-indigo-50 text-indigo-700 border-indigo-200'],
  ['green', 'bg-green-500', 'bg-green-50 text-green-700 border-green-200'],
];

const TYPE: Array<[string, string, string]> = [
  ['text-display', 'text-display font-light', '48 / 56'],
  ['text-heading-lg', 'text-heading-lg font-bold', '36 / 44'],
  ['text-heading', 'text-heading font-bold', '28 / 36 page title'],
  ['text-title', 'text-title font-bold', '22 / 28 panel title'],
  ['text-lead', 'text-lead font-bold', '20 / 28 Home row title'],
  ['text-body-lg', 'text-body-lg font-bold', '18 / 28 row title'],
  ['text-body', 'text-body', '16 / 24 body'],
  ['text-caption', 'text-caption', '14 / 20 metadata'],
  ['text-micro', 'text-micro', '12 / 16 kbd, counts only'],
];

export function TokensSection() {
  return (
    <Section id="tokens" title="Tokens" intro="Navy-night surfaces in four steps; text in three tiers; colour only as an indicator. Every pair is checked by npm run contrast.">
      <Specimen label="Surfaces" note="elevation = lightness">
        <div className="grid w-full grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-2">
          {SURFACES.map(([name, cls, use]) => (
            <div key={name} className={`flex h-20 flex-col justify-end rounded-md border border-line p-2 ${cls}`}>
              <span className="text-caption font-bold text-fg">{name}</span>
              <span className="text-micro text-muted">{use}</span>
            </div>
          ))}
        </div>
      </Specimen>
      <Specimen label="Text tiers">
        <span className="text-body font-bold text-fg-heading">Heading</span>
        <span className="text-body text-fg">Body text</span>
        <span className="text-body text-muted">Muted metadata</span>
        <span className="text-body text-faint">Faint timestamp</span>
        <span className="text-body text-disabled">Disabled</span>
        <a href="#tokens" className="text-body">
          A link
        </a>
      </Specimen>
      <Specimen label="Action + focus" note="one filled accent per region">
        <span className="inline-flex h-9 items-center rounded-md bg-accent px-3.5 text-body font-bold text-on-accent">accent / on-accent</span>
        <span className="inline-flex h-9 items-center rounded-md bg-accent-hover px-3.5 text-body font-bold text-on-accent">accent-hover</span>
        <span className="inline-flex h-9 items-center rounded-md bg-surface px-3.5 text-body text-fg shadow-focus">focus ring</span>
        <span className="inline-flex h-9 items-center rounded-md border border-line-input bg-surface-input px-3 text-body text-faint">line-input on input</span>
        <span className="inline-flex h-9 items-center rounded-md bg-surface-inverse px-3 text-caption text-on-inverse">inverse (tooltip)</span>
      </Specimen>
      <Specimen label="Status + AI" note="50 · 200 · 500 · 600 · 700">
        <div className="grid w-full gap-1.5">
          {STATUS_RAMPS.map((r) => (
            <div key={r.name} className="grid grid-cols-[5rem_repeat(5,minmax(0,1fr))] items-center gap-1.5">
              <span className="text-caption text-muted">{r.name}</span>
              {r.cls.map((c) => (
                <span key={c} className={`h-6 rounded-sm ${c}`} />
              ))}
            </div>
          ))}
        </div>
      </Specimen>
      <Specimen label="Categorical" note="charts and labels only; never an account or source">
        {CATEGORICAL.map(([name, dot, tag]) => (
          <span key={name} className={`inline-flex h-6 items-center gap-1.5 rounded-sm border px-2 text-caption font-bold ${tag}`}>
            <span className={`size-2 rounded-full ${dot}`} />
            {name}
          </span>
        ))}
      </Specimen>
      <Specimen label="Type" note="16 px base; nothing under 12" stack>
        {TYPE.map(([name, cls, note]) => (
          <div key={name} className="flex items-baseline gap-4">
            <span className={`min-w-0 truncate text-fg-heading ${cls}`}>Ready by 13:30</span>
            <span className="shrink-0 text-caption text-muted">
              {name} · {note}
            </span>
          </div>
        ))}
      </Specimen>
      <Specimen label="Atmosphere" note="2026 glow, ≤ 12 % alpha, top of canvas">
        <div className="h-24 w-full rounded-lg border border-line bg-bg bg-atmosphere" />
        <div className="h-10 w-40 rounded-md bg-gradient-brand" title="logo tile only" />
        <div className="grid h-10 w-40 place-items-center rounded-md bg-agentic text-caption font-bold">agentic mesh</div>
        <div className="grid h-10 w-48 place-items-center rounded-md border-agentic text-caption text-fg">border-agentic</div>
      </Specimen>
    </Section>
  );
}

// ── Buttons + keys ──────────────────────────────────────────────────────────────────────────

const VARIANTS: ButtonVariant[] = ['primary', 'secondary', 'quiet', 'danger', 'ai'];
const SIZES: ButtonSize[] = ['xs', 'sm', 'md'];
const VERB: Record<ButtonVariant, string> = { primary: 'Send draft', secondary: 'Edit', quiet: 'Review draft', ghost: 'Snooze', danger: 'Discard', ai: 'Regenerate' };

export function ButtonsSection() {
  const [pressed, setPressed] = useState(true);
  return (
    <Section id="buttons" title="Buttons and keys" intro="rounded-md, bold, never pill. Primary is the one filled accent; quiet is the row verb; ghost still works as an alias of quiet.">
      {SIZES.map((size) => (
        <Specimen key={size} label={`size="${size}"`} note={size === 'md' ? '36 px · compact 32' : size === 'sm' ? '32 px · compact 28' : '28 px · compact 24'}>
          {VARIANTS.map((v) => (
            <Button key={v} variant={v} size={size}>
              {VERB[v]}
            </Button>
          ))}
        </Specimen>
      ))}
      <Specimen label="Key hint · icon">
        <Button variant="primary" kbd="mod+enter" icon="send">
          Approve and send
        </Button>
        <Button variant="secondary" kbd="e">
          Edit
        </Button>
        <Button variant="ghost" kbd="s">
          Snooze
        </Button>
        <Button variant="secondary" iconRight="new_window" size="sm">
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
        <Button variant="quiet" disabled>
          Draft reply
        </Button>
        <Button variant="ai" disabled>
          Apply
        </Button>
      </Specimen>
      <Specimen label="IconButton" note="ghost · header · outline · solid · badge · pressed">
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
      <Specimen label="Kbd · KbdHint" note="mono is for keys only">
        <Kbd>Esc</Kbd>
        <KbdHint combo="mod+k" />
        <KbdHint combo="mod+j" />
        <KbdHint combo="shift+enter" />
        <KbdHint combo="g h" />
        <KbdHint combo="j|k" />
        <KbdHint combo="e" tone="quiet" />
        <span className="inline-flex items-center gap-2 rounded-md bg-accent px-3 py-1.5 text-caption font-bold text-on-accent">
          inverse <KbdHint combo="mod+enter" tone="inverse" />
        </span>
      </Specimen>
    </Section>
  );
}

// ── Status marks ────────────────────────────────────────────────────────────────────────────

const TONES: Tone[] = ['risk', 'warn', 'ok', 'brand', 'ai', 'neutral'];
const TONE_WORD: Record<Tone, string> = { risk: 'Overdue', warn: 'At risk', ok: 'Ready', brand: 'In progress', ai: 'Drafted', neutral: 'Snoozed' };

export function StatusSection() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => setNow(new Date()), []);
  const at = (min: number) => new Date((now?.getTime() ?? 0) + min * 60_000).toISOString();
  return (
    <Section id="status" title="Status marks" intro="An icon plus a word on a tint, status colours only. At most one colour signal per row.">
      {(['xs', 'sm', 'md'] as const).map((size) => (
        <Specimen key={size} label={`StatePill ${size}`}>
          {TONES.map((t) => (
            <StatePill key={t} tone={t} size={size} label={TONE_WORD[t]} />
          ))}
        </Specimen>
      ))}
      <Specimen label="dot · dashed · icon" note="icon={false} hides the tone icon">
        <StatePill tone="ok" dot label="Draft ready" />
        <StatePill tone="brand" dot label="Settling" />
        <StatePill tone="brand" dashed label="Pending approval" />
        <StatePill tone="ai" dashed label="Suggested" />
        <StatePill tone="risk" icon="ban" label="Blocked" />
        <StatePill tone="warn" icon={false} label="Reopened" />
      </Specimen>
      <Specimen label="CountBadge" note="brand = must act · risk = overdue · neutral = reading">
        <CountBadge count={4} />
        <CountBadge count={12} tone="risk" />
        <CountBadge count={3} tone="neutral" />
        <CountBadge count={140} />
      </Specimen>
      <Specimen label="Eyebrow" note="sentence case, 14 px bold">
        <Eyebrow count={2}>Waiting on you</Eyebrow>
        <Eyebrow count={5}>Closed for you</Eyebrow>
        <Eyebrow tone="ai">Proposed change</Eyebrow>
        <Eyebrow tone="brand">Draft · Slack</Eyebrow>
        <Eyebrow tone="risk">Needs re-auth</Eyebrow>
      </Specimen>
      <Specimen label="ConfidenceWord" note="a word, never a %">
        <ConfidenceWord value="sure" />
        <ConfidenceWord value="likely" />
        <ConfidenceWord value="guess" />
      </Specimen>
      <Specimen label="EffortSplit" note="hands-on vs background, never summed">
        <EffortSplit youMin={20} agentMin={20} />
        <EffortSplit youMin={5} agentMin={100} compact />
        <EffortSplit youMin={10} />
      </Specimen>
      <Specimen label="StartBy" note="calm · ▲ within 15 min · late">
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
        <span className="inline-flex items-center gap-2 text-body text-fg">
          Reply to Dana: confirm scope <StaleMark reason="Gmail needs re-auth since 09:40; this may be out of date." />
        </span>
        <StaleMark reason="Slack is catching up (60%).">behind</StaleMark>
      </Specimen>
    </Section>
  );
}

// ── Chips ───────────────────────────────────────────────────────────────────────────────────

const SOURCES: SourceKind[] = ['slack', 'gmail', 'calendar', 'drive', 'gemini', 'org62', 'vdp', 'claude', 'manual'];
const ENTITIES: Array<[EntityKind, string]> = [
  ['account', 'ACME Corp'],
  ['opp', 'ACME · DC expansion FY27'],
  ['initiative', 'Phase 2 demo'],
  ['person', 'Dana Reyes'],
  ['session', 'Gap notes'],
  ['file', 'ACME Phase 2 deck'],
];

export function ChipsSection() {
  const [ctx, setCtx] = useState(['Reply to Dana: confirm scope', 'ACME Corp']);
  return (
    <Section id="chips" title="References" intro="Sources, accounts and people are neutral: a glyph or letter avatar, never a hue.">
      <Specimen label="SourceChip" note="plain">
        {SOURCES.map((s) => (
          <SourceChip key={s} source={s} />
        ))}
      </Specimen>
      <Specimen label="SourceChip" note="href · compact">
        <SourceChip source="slack" label="#acme-ext · thread" href="https://example.com/slack" />
        <SourceChip source="gmail" label="Dana Reyes · Re: scope" href="https://example.com/mail" />
        <SourceChip source="org62" label="Opp · DC expansion" href="/deals" />
        {SOURCES.slice(0, 5).map((s) => (
          <SourceChip key={s} source={s} compact href="/" />
        ))}
      </Specimen>
      <Specimen label="EntityChip" note="plain · href · compact">
        {ENTITIES.slice(0, 4).map(([k, l]) => (
          <EntityChip key={k} kind={k} label={l} />
        ))}
        {ENTITIES.slice(0, 3).map(([k, l]) => (
          <EntityChip key={`${k}-h`} kind={k} label={l} href="/deals" />
        ))}
        {ENTITIES.map(([k, l]) => (
          <EntityChip key={`${k}-c`} kind={k} label={l} href="/deals" compact />
        ))}
      </Specimen>
      <Specimen label="LetterAvatar" note="sm · md; round = person">
        {ENTITIES.map(([k, l]) => (
          <LetterAvatar key={k} kind={k} label={l} />
        ))}
        {ENTITIES.map(([k, l]) => (
          <LetterAvatar key={`${k}-m`} kind={k} label={l} size="md" />
        ))}
      </Specimen>
      <Specimen label="ContextChip" note="chat context; removable">
        {ctx.map((c, i) => (
          <ContextChip key={c} label={c} kind={i === 1 ? 'account' : undefined} icon={i === 0 ? 'task' : undefined} onRemove={() => setCtx((p) => p.filter((x) => x !== c))} />
        ))}
        <ContextChip label="Home" icon="home" />
        {ctx.length < 2 ? (
          <Button size="xs" variant="quiet" onClick={() => setCtx(['Reply to Dana: confirm scope', 'ACME Corp'])}>
            Reset
          </Button>
        ) : null}
      </Specimen>
      <Specimen label="ObjectTile" note="de-emphasized, neutral; use sparingly">
        {['account', 'opportunity', 'event', 'task', 'email', 'report'].map((n) => (
          <Cell key={n} label={n}>
            <ObjectTile name={n} size="md" />
          </Cell>
        ))}
        <Cell label="lg">
          <ObjectTile name="data_cloud" />
        </Cell>
      </Specimen>
      <Specimen label="Icon" note="xs 12 · sm 14 · md 16 · lg 20 · xl 24">
        {(['xs', 'sm', 'md', 'lg', 'xl'] as const).map((s) => (
          <Icon key={s} name="sparkles" size={s} className="text-ai-700" />
        ))}
        {['check', 'warning', 'error', 'ban', 'clock', 'send', 'new_window'].map((n) => (
          <Icon key={n} name={n} className="text-muted" />
        ))}
      </Specimen>
    </Section>
  );
}

// ── Lists ───────────────────────────────────────────────────────────────────────────────────

const ROWS: Array<{ id: string; title: string; why: string; verb: string; priority?: Priority; pill?: { tone: Tone; label: string } }> = [
  { id: 'r1', title: 'Answer Dana before the 14:30 prep', why: '~5m once the SE answers', verb: 'Send draft', priority: 'risk', pill: { tone: 'risk', label: 'Blocked' } },
  { id: 'r2', title: 'Reply to ACME on the pilot hold', why: 'Due Sat 11/7', verb: 'Draft reply' },
  { id: 'r3', title: 'Field engagements recap → team', why: 'Due Mon 11/9', verb: 'Review draft', pill: { tone: 'ai', label: 'Drafted' } },
  { id: 'r4', title: 'Confirm the workshop agenda', why: 'Workshop 11/12 · prep missing', verb: 'Draft reply', priority: 'warn' },
];

function RowSecondary() {
  return (
    <>
      <IconButton icon="clock" label="Snooze" size="xs" />
      <IconButton icon="check" label="Done" size="xs" />
    </>
  );
}

export function ListsSection() {
  const [sel, setSel] = useState<string | null>('r3');
  return (
    <Section id="lists" title="Lists: quiet actions, loud selection" intro="Each row keeps its verb as quiet text. Only the selected row (or the #1 item while nothing is selected) gets the filled button; snooze and done show on hover or selection.">
      <Specimen label="ListContainer" note="boxed · click a row" stack>
        <ListContainer label="Reply and approve">
          <ListHeader trailing={<span className="text-caption text-muted">4</span>}>Reply and approve</ListHeader>
          {ROWS.map((r) => (
            <ListRow
              key={r.id}
              tall
              priority={r.priority}
              selected={sel === r.id}
              onClick={() => setSel(r.id)}
              primaryAction={{ label: r.verb, kbd: 'mod+enter', onClick: () => undefined }}
              secondaryActions={<RowSecondary />}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-body-lg font-bold text-fg-heading">{r.title}</p>
                <p className="flex items-center gap-2 truncate text-caption text-muted">
                  {r.pill ? <StatePill tone={r.pill.tone} label={r.pill.label} size="xs" /> : null}
                  {r.why}
                </p>
              </div>
            </ListRow>
          ))}
        </ListContainer>
      </Specimen>
      <Specimen label="emphasized · inPanel" note="#1 with nothing selected; open in the panel stays quiet" stack>
        <ListContainer label="Do now" variant="plain">
          <ListGroupHeader label="Do now" count={3} />
          <ListRow emphasized primaryAction={{ label: 'Start smoke test' }} secondaryActions={<RowSecondary />}>
            <span className="min-w-0 flex-1 truncate font-bold text-fg-heading">#1 · Smoke-test both demos</span>
            <EffortSplit youMin={15} agentMin={20} compact />
          </ListRow>
          <ListRow selected inPanel primaryAction={{ label: 'Approve' }} secondaryActions={<RowSecondary />}>
            <span className="min-w-0 flex-1 truncate font-bold text-fg-heading">Selected, open in the panel</span>
          </ListRow>
          <ListRow dashed primaryAction={{ label: 'Accept' }}>
            <span className="min-w-0 flex-1 truncate text-fg">Suggested (dashed) · AI proposed it</span>
            <StatePill tone="ai" label="Suggested" size="xs" dashed />
          </ListRow>
        </ListContainer>
      </Specimen>
      <Specimen label="RowVerb" note="for cards: quiet vs filled">
        <RowVerb action={{ label: 'Draft reply' }} />
        <RowVerb action={{ label: 'Draft reply', kbd: 'mod+enter' }} filled />
        <RowVerb action={{ label: 'Sending', loading: true }} filled size="sm" />
      </Specimen>
      <Specimen label="Group header" stack>
        <ListContainer label="Groups">
          <ListGroupHeader label="Waiting on others" count={2} collapsed={false} onToggle={() => undefined} trailing={<Button size="xs" variant="quiet">Nudge all</Button>} />
          <ListRow priority="none">
            <span className="min-w-0 flex-1 truncate">Dana · pricing sheet</span>
            <span className="text-caption text-muted">3d</span>
          </ListRow>
          <ListRow priority="brand">
            <span className="min-w-0 flex-1 truncate">Now: ACME sync</span>
            <span className="text-caption text-muted">10:00</span>
          </ListRow>
        </ListContainer>
      </Specimen>
    </Section>
  );
}

// ── Tabs + toggles ──────────────────────────────────────────────────────────────────────────

export function TabsSection() {
  const [tab, setTab] = useState('details');
  const [tab2, setTab2] = useState('evidence');
  const [seg, setSeg] = useState('roomy');
  const [seg2, setSeg2] = useState('dark');
  return (
    <Section id="tabs" title="Tabs and toggles" intro="Selected tab = a selected surface, not a 3 px underline. The line variant is a subtle 2 px accent for dense rows.">
      <Specimen label="Tabs md (pill)" stack>
        <Tabs
          label="Panel"
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'details', label: 'Details' },
            { value: 'assistant', label: 'Assistant', icon: 'sparkles' },
            { value: 'history', label: 'History', count: 4 },
            { value: 'off', label: 'Disabled', disabled: true },
          ]}
          trailing={<KbdHint combo="mod+j" />}
        />
      </Specimen>
      <Specimen label="Tabs sm (pill)" stack>
        <Tabs
          size="sm"
          label="Detail"
          value={tab2}
          onChange={setTab2}
          tabs={[
            { value: 'evidence', label: 'Evidence', count: 3 },
            { value: 'context', label: 'Context' },
            { value: 'related', label: 'Related', count: 0 },
          ]}
        />
      </Specimen>
      <Specimen label="Tabs line" stack>
        <Tabs
          variant="line"
          size="sm"
          label="Detail (line)"
          value={tab2}
          onChange={setTab2}
          tabs={[
            { value: 'evidence', label: 'Evidence', count: 3 },
            { value: 'context', label: 'Context' },
            { value: 'related', label: 'Related', count: 0 },
          ]}
        />
      </Specimen>
      <Specimen label="SegmentedToggle" note="xs · sm · md">
        <SegmentedToggle
          size="xs"
          label="Density"
          value={seg}
          onChange={setSeg}
          options={[
            { value: 'roomy', label: 'Roomy' },
            { value: 'compact', label: 'Compact' },
          ]}
        />
        <SegmentedToggle
          label="Theme"
          value={seg2}
          onChange={setSeg2}
          options={[
            { value: 'dark', label: 'Dark' },
            { value: 'light', label: 'Light' },
            { value: 'system', label: 'System' },
          ]}
        />
        <SegmentedToggle
          size="md"
          label="Text size"
          value={seg}
          onChange={setSeg}
          options={[
            { value: 'roomy', label: 'Default', icon: 'text' },
            { value: 'compact', label: 'Large' },
            { value: 'off', label: 'Huge', disabled: true },
          ]}
        />
      </Specimen>
    </Section>
  );
}

// ── Panel states ────────────────────────────────────────────────────────────────────────────

const BANNERS: Array<[BannerTone, string, string]> = [
  ['risk', 'VDP needs re-auth', 'Drafts that touch VDP wait until you reconnect.'],
  ['warn', 'Slack is catching up', '60% through the backlog.'],
  ['ok', 'All sources live', 'Dry run is on.'],
  ['info', 'New scan available', 'It found 3 changes since 08:00.'],
  ['ai', 'Proposed plan', 'The agent moved 2 items to tomorrow.'],
];

export function StatesSection() {
  // Client-only timestamp (no SSR/hydration mismatch on the "Saved · 4s ago" title).
  const [savedAt, setSavedAt] = useState<number | null>(null);
  useEffect(() => setSavedAt(Date.now() - 4000), []);
  return (
    <Section id="states" title="Panel states" intro="Every panel has empty, loading, error and stale states. Calm copy, no emoji.">
      <Specimen label="Skeleton" note="line · row · card · block" stack>
        <Skeleton count={3} className="max-w-md" />
        <div className="overflow-hidden rounded-lg border border-line">
          <Skeleton variant="row" count={2} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Skeleton variant="card" />
          <Skeleton variant="block" className="h-full min-h-24 w-full" />
        </div>
      </Specimen>
      <Specimen label="EmptyState" note="inline · panel" stack>
        <EmptyState size="inline" icon="check" title="That's everything." body="Nothing needs you right now." />
        <div className="rounded-lg border border-line">
          <EmptyState icon="inbox" title="Nothing to approve" body="Drafts land here before anything leaves the machine." action={<Button size="sm">Open Outbox</Button>} />
        </div>
      </Specimen>
      <Specimen label="Banner" note="panel scope" stack>
        {BANNERS.map(([tone, title, body]) => (
          <Banner key={tone} tone={tone} title={title} body={body} action={tone === 'risk' ? <Button size="xs" variant="primary">Re-auth</Button> : undefined} onDismiss={tone === 'info' ? () => undefined : undefined} />
        ))}
      </Specimen>
      <Specimen label="InlineStatus">
        <InlineStatus state="saving" />
        <InlineStatus state="dirty" />
        {savedAt ? <InlineStatus state="saved" savedAt={savedAt} /> : null}
        <InlineStatus state="error" onRetry={() => undefined} />
        <InlineStatus state="conflict" />
      </Specimen>
      <Specimen label="ChangedElsewhere" stack>
        <ChangedElsewhere
          className="max-w-lg"
          fields={[
            { field: 'due', label: 'Due', mine: 'Fri 12:00', theirs: 'Thu 17:00' },
            { field: 'title', label: 'Title', mine: 'Confirm Q4 log rows', theirs: 'Confirm the Q4 log' },
          ]}
          onKeepMine={() => undefined}
          onTakeTheirs={() => undefined}
        />
      </Specimen>
      <Specimen label="PanelError" stack>
        <div className="rounded-lg border border-line">
          <PanelError error={new Error('fetch failed: 502 from /api/v1/views/home')} onRetry={() => undefined} />
        </div>
      </Specimen>
    </Section>
  );
}
