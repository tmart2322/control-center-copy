'use client';
/** Pieces of a missed opp shared by the Missed list and its Details renderer: notes, evidence, the prompt draft. */
import { useMemo } from 'react';
import type { MissedOpp } from '@/contract';
import { cn, Icon, SourceChip } from '@/ui';
import { CopyButton } from './CopyButton';
import { dcPromptDraft, evidenceChip, type MissedNotes } from './missed';

function NoteLine({ icon, tone, children }: { icon: string; tone: 'danger' | 'warning' | 'muted'; children: React.ReactNode }) {
  return (
    <p className={cn('flex items-start gap-1.5 text-caption', tone === 'danger' ? 'text-danger-700' : tone === 'warning' ? 'text-warning-700' : 'text-muted')}>
      <Icon name={icon} size="xs" className="mt-1 shrink-0" />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

/** Lock, split and stranded notes. Only the most severe one carries color (one color signal per row). */
export function NotesBlock({ notes }: { notes: MissedNotes }) {
  if (!notes.lock && !notes.lockSoon && !notes.split && !notes.stranded) return null;
  const lead = notes.lock ? 'lock' : notes.lockSoon ? 'lockSoon' : notes.stranded ? 'stranded' : 'split';
  return (
    <div className="mt-1.5 space-y-0.5" data-testid="missed-notes">
      {notes.lock ? <NoteLine icon="lock" tone="danger">{notes.lock}</NoteLine> : null}
      {notes.lockSoon ? <NoteLine icon="clock" tone={lead === 'lockSoon' ? 'warning' : 'muted'}>{notes.lockSoon}</NoteLine> : null}
      {notes.stranded ? <NoteLine icon="warning" tone={lead === 'stranded' ? 'warning' : 'muted'}>{notes.stranded}</NoteLine> : null}
      {notes.split ? <NoteLine icon="groups" tone="muted">{notes.split}</NoteLine> : null}
    </div>
  );
}

export function EvidenceChips({ evidence }: { evidence: string[] }) {
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1">
      {evidence.map((e) => (
        <span key={e} title={e} className="inline-flex max-w-full min-w-0">
          <SourceChip source={evidenceChip(e).source} label={e} />
        </span>
      ))}
    </div>
  );
}

/** The Slackbot prompt draft on a claimed row. Dashed and neutral: a draft, nothing has been sent. */
export function PromptDraft({ m }: { m: MissedOpp }) {
  const text = useMemo(() => dcPromptDraft(m), [m]);
  return (
    <div className="mt-2 max-w-[80ch] rounded-md border border-dashed border-line-strong bg-surface-muted p-3" data-testid="dc-prompt-draft" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center gap-2">
        <Icon name="edit" size="xs" className="text-muted" />
        <span className="text-caption font-bold text-fg">Draft for Slackbot “DC Comment Upload”</span>
        <span className="ml-auto">
          <CopyButton text={text} label="Copy prompt" />
        </span>
      </div>
      <pre className="cc-scroll mt-1.5 max-h-48 overflow-auto font-mono text-caption whitespace-pre-wrap text-fg">{text}</pre>
      <p className="mt-1.5 text-caption text-muted">Nothing is sent. Paste it into Slackbot yourself; Slackbot writes the DC after you approve it there.</p>
    </div>
  );
}
