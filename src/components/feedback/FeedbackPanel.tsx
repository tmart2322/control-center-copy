'use client';
/**
 * The Feedback panel (D-56): "Report a bug / idea" in the docked right panel (`registerDetailRenderer('feedback')`).
 *
 *   write      Bug or Idea, a short description; the captured context (page, Looking at, build, persona, errors)
 *   diagnose   POST /feedback/diagnose: names become placeholders first; the read-only agent (or the app's own
 *              reading) writes the report; the Slack message comes back for editing
 *   review     edit the final message (scrubbed again on the server before it is staged)
 *   confirm    POST /feedback/reports made ONE Outbox item; this shows the exact payload and where it posts
 *   send       POST /drafts/:id/dispatch with the confirm token. Dry run (or "Post live" off): nothing is posted, the
 *              payload is shown and the message is copied. Live: one post to the configured channel only.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { routes, type DiagnoseFeedbackResult, type DispatchResult, type FeedbackContextInput, type FeedbackKind, type StageFeedbackResult } from '@/contract';
import { ApiError, api } from '@/client/api';
import { useApi } from '@/client/hooks';
import { usePersona } from '@/client/persona';
import { copyToClipboard, CopyButton, Facts, PanelFrame, PanelSection, QuietAction, StateBadge, Tag } from '@/components/panels/bits';
import { AppLink } from '@/components/shell/AppLink';
import { Button, PanelBoundary, SegmentedToggle, Spinner } from '@/ui';
import { recentClientErrors } from './client-errors';
import { captureFeedbackContext, CLIENT_BUILD, feedbackContextFor } from './context';

type Step = 'write' | 'diagnosing' | 'review' | 'staging' | 'confirm' | 'sending' | 'done';

const errText = (e: unknown) => (e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e));

const area = 'w-full rounded-md border border-line-input bg-surface p-3 text-body text-fg placeholder:text-faint focus:border-brand-600 focus:outline-none';

/** lane E's version route, when the route table has one (no 404 probe before it lands). */
const HAS_VERSION_ROUTE = Object.values(routes).some((r) => r.path === '/version');

/** lane E's GET /version when it exists; null otherwise (the server's package.json version comes from GET /feedback). */
function useVersionRoute() {
  return useQuery({
    queryKey: ['settings', 'feedback.version'],
    enabled: HAS_VERSION_ROUTE,
    queryFn: async () => {
      const r = await fetch('/api/v1/version', { headers: { accept: 'application/json' }, cache: 'no-store' });
      if (!r.ok) return null;
      const j = (await r.json()) as { version?: unknown; sha?: unknown };
      return { version: typeof j.version === 'string' ? j.version : '', sha: typeof j.sha === 'string' ? j.sha : null };
    },
    retry: false,
    staleTime: Infinity,
  });
}

export function FeedbackPanel({ reportId }: { reportId: string }) {
  return (
    <PanelBoundary name="feedback.panel" resetKeys={[reportId]}>
      <FeedbackBody reportId={reportId} />
    </PanelBoundary>
  );
}

function FeedbackBody({ reportId }: { reportId: string }) {
  const qc = useQueryClient();
  const state = useApi('getFeedback');
  const versionRoute = useVersionRoute();
  const persona = usePersona();
  const [captured] = useState<FeedbackContextInput>(
    () =>
      feedbackContextFor(reportId) ??
      captureFeedbackContext({
        pathname: typeof window === 'undefined' ? '/' : window.location.pathname,
        search: typeof window === 'undefined' ? '' : window.location.search,
        errors: recentClientErrors(),
        viewport: typeof window === 'undefined' ? null : { width: window.innerWidth, height: window.innerHeight },
        version: CLIENT_BUILD.version,
        sha: CLIENT_BUILD.sha,
      }),
  );
  const context = useMemo<FeedbackContextInput>(
    () => ({
      ...captured,
      version: captured.version || versionRoute.data?.version || state.data?.version || '',
      sha: captured.sha ?? versionRoute.data?.sha ?? state.data?.sha ?? null,
      persona: captured.persona ?? (persona ? persona.levelLabel || persona.label : null),
    }),
    [captured, versionRoute.data, state.data, persona],
  );

  const [step, setStep] = useState<Step>('write');
  const [kind, setKind] = useState<FeedbackKind>('bug');
  const [text, setText] = useState('');
  const [diag, setDiag] = useState<DiagnoseFeedbackResult | null>(null);
  const [message, setMessage] = useState('');
  const [staged, setStaged] = useState<StageFeedbackResult | null>(null);
  const [sent, setSent] = useState<DispatchResult | null>(null);
  // After a live Send: the post's own status and permalink as delivery finishes (the Outbox lists it under Sent)
  const live = useApi('getDraft', { params: { id: sent?.draft.id ?? '' } }, { enabled: !!sent && !sent.dryRun });
  const posted = sent && !sent.dryRun ? (live.data ?? sent.draft) : null;
  const [copied, setCopied] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  const channel = staged?.channel ?? diag?.channel ?? state.data?.channel ?? null;
  const where = channel?.id ? channel.name || channel.id : null;

  const diagnose = async () => {
    setError(null);
    setStep('diagnosing');
    try {
      const r = await api('diagnoseFeedback', { body: { kind, text, context } });
      setDiag(r);
      setMessage(r.message);
      setStep('review');
    } catch (e) {
      setError(`Couldn’t diagnose it: ${errText(e)}`);
      setStep('write');
    }
  };

  const stage = async () => {
    if (!diag) return;
    setError(null);
    setStep('staging');
    try {
      const r = await api('stageFeedback', { body: { report: diag.report, message, replaces: staged?.draft.id ?? null } });
      setStaged(r.entity);
      setStep('confirm');
      void qc.invalidateQueries({ queryKey: ['outbox'] });
    } catch (e) {
      setError(`Couldn’t prepare the post: ${errText(e)}`);
      setStep('review');
    }
  };

  const send = async () => {
    if (!staged) return;
    setError(null);
    setStep('sending');
    try {
      const r = await api('dispatchDraft', { params: { id: staged.draft.id }, body: { ifVersion: staged.draft.version, mode: 'send', confirmToken: staged.preview.confirmToken } });
      setSent(r);
      if (r.dryRun) setCopied(await copyToClipboard(String(r.payload.text ?? '')));
      setStep('done');
      void qc.invalidateQueries({ queryKey: ['outbox'] });
      void qc.invalidateQueries({ queryKey: ['draft'] });
    } catch (e) {
      setError(`Couldn’t send it: ${errText(e)}`);
      setStep('confirm');
    }
  };

  const reset = () => {
    setStep('write');
    setText('');
    setDiag(null);
    setMessage('');
    setStaged(null);
    setSent(null);
    setCopied(null);
    setError(null);
  };

  const ctxFacts = (
    <Facts
      rows={[
        ['Page', [context.page, context.route].filter(Boolean).join(' · ')],
        context.lookingAt ? ['Looking at', `${context.lookingAt.kind.replace(/_/g, ' ')}${context.lookingAt.label ? ` · ${context.lookingAt.label}` : ''}`] : null,
        ['Version', [context.version ? `v${context.version}` : 'unknown', context.sha?.slice(0, 7)].filter(Boolean).join(' · ')],
        ['Persona', context.persona ?? '…'],
        ['Browser errors', context.clientErrors.length ? `${context.clientErrors.length} recent` : 'None'],
      ]}
    />
  );

  const errorLine = error ? (
    <p role="alert" className="text-body text-danger-700" data-feedback-error>
      {error}
    </p>
  ) : null;

  const noChannel = (
    <p className="text-body text-warning-700" data-feedback-no-channel>
      No feedback channel is set, so this can’t be sent yet. Add the channel id in{' '}
      <AppLink href="/settings?section=feedback" className="font-bold text-link underline">
        Settings ▸ Feedback
      </AppLink>
      , or copy the text and paste it yourself.
    </p>
  );

  const dryLine = channel ? (channel.live ? <>Send posts to {where} as you.</> : !channel.postLive ? <>“Post live” is off (Settings ▸ Feedback): Send shows the payload and copies the message.</> : <>Dry run is on: Send shows the payload and copies the message; nothing is posted.</>) : null;

  const context_line = (
    <>
      <span className="font-bold text-fg">Feedback</span>
      <Tag>{kind === 'bug' ? 'Bug' : 'Idea'}</Tag>
      {step === 'done' ? <StateBadge tone={sent?.dryRun ? 'neutral' : 'ok'} label={sent?.dryRun ? 'Dry run' : 'Sent'} /> : channel && !channel.live ? <StateBadge tone="neutral" label="Dry run" /> : null}
    </>
  );

  // ── write / diagnosing ──────────────────────────────────────────────────────────────────
  if (step === 'write' || step === 'diagnosing') {
    const busy = step === 'diagnosing';
    return (
      <PanelFrame
        label="Report a bug or idea"
        context={context_line}
        title="Report a bug / idea"
        sub="It goes to the team’s feedback channel, diagnosed, with names and ids swapped for placeholders. You see and edit the final text before anything is sent."
        primary={{ id: 'diagnose', label: busy ? 'Diagnosing…' : 'Diagnose', icon: 'einstein', loading: busy, disabled: busy || text.trim().length < 3, hint: 'Say what happened in a few words', run: () => void diagnose() }}
        data-feedback-step={step}
      >
        <PanelSection title="What is it?">
          <SegmentedToggle label="Bug or idea" value={kind} onChange={setKind} options={[{ value: 'bug', label: 'Bug' }, { value: 'idea', label: 'Idea' }]} />
        </PanelSection>
        <PanelSection title={kind === 'bug' ? 'What happened?' : 'What would help?'}>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={6}
            maxLength={4000}
            disabled={busy}
            data-feedback-text
            aria-label={kind === 'bug' ? 'What happened' : 'What would help'}
            placeholder={kind === 'bug' ? 'What you did, what you expected, what happened instead' : 'What you’d like the app to do, and when it would help'}
            className={area}
          />
          {busy ? (
            <p className="mt-2 flex items-center gap-2 text-caption text-muted" aria-live="polite">
              <Spinner size="sm" /> {state.data?.agent ? `Reading the app’s errors, jobs and the code (up to $${(state.data.capUsd || 0.4).toFixed(2)} on the Assistant’s line)…` : 'Reading the app’s errors, jobs and connectors…'}
            </p>
          ) : null}
        </PanelSection>
        <PanelSection title="Context" suffix="captured for you">
          {ctxFacts}
          <p className="mt-2 text-caption text-muted">Names, emails, Slack and Org62 ids become placeholders (CUSTOMER_1, PERSON_2, OPP_3) before the diagnosis sees them, and again before Send.</p>
        </PanelSection>
        {errorLine}
      </PanelFrame>
    );
  }

  // ── review / staging ────────────────────────────────────────────────────────────────────
  if ((step === 'review' || step === 'staging') && diag) {
    const busy = step === 'staging';
    return (
      <PanelFrame
        label="Review the feedback report"
        context={context_line}
        title={diag.report.title}
        sub={
          <>
            {diag.diagnosedBy === 'agent' ? `Diagnosed by the read-only agent${diag.costUsd ? ` · $${diag.costUsd.toFixed(2)}` : ''}` : 'The app’s own reading (no model call)'} · {diag.scrubbed} name{diag.scrubbed === 1 ? '' : 's'} and id{diag.scrubbed === 1 ? '' : 's'} replaced
            {diag.note ? <span className="block text-caption">{diag.note}</span> : null}
          </>
        }
        primary={{ id: 'stage', label: busy ? 'Preparing…' : 'Send…', icon: 'send', loading: busy, disabled: busy || !channel?.id || !message.trim(), hint: channel?.id ? 'The message is empty' : 'Set the feedback channel first', run: () => void stage() }}
        quiet={
          <>
            <QuietAction icon="back" onClick={() => setStep('write')} data-feedback-back>
              Back
            </QuietAction>
            <CopyButton text={message} label="Copy text" />
          </>
        }
        data-feedback-step={step}
      >
        <PanelSection title="The message" suffix="edit anything; it is scrubbed again before Send">
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={16} maxLength={6000} disabled={busy} data-feedback-message aria-label="The feedback message" className={`${area} font-mono text-caption leading-relaxed`} />
        </PanelSection>
        <PanelSection title="Diagnosis" suffix={`${diag.report.diagnosis.confidence} confidence`}>
          <Facts
            rows={[
              ['Cause', diag.report.diagnosis.cause || 'Not found'],
              diag.report.diagnosis.files.length ? ['Files', <span key="f" className="font-mono text-caption">{diag.report.diagnosis.files.join(', ')}</span>] : null,
            ]}
          />
        </PanelSection>
        <PanelSection title="Where it goes">
          {channel?.id ? (
            <p className="text-body text-fg" data-feedback-channel={channel.id}>
              {where}
              <span className="text-muted"> · {channel.source === 'settings' ? 'Settings ▸ Feedback' : 'the team default (config/team.json)'}</span>
              <span className="block text-caption text-muted">{dryLine}</span>
            </p>
          ) : (
            noChannel
          )}
        </PanelSection>
        {errorLine}
      </PanelFrame>
    );
  }

  // ── confirm / sending ───────────────────────────────────────────────────────────────────
  if ((step === 'confirm' || step === 'sending') && staged) {
    const busy = step === 'sending';
    const p = staged.preview.payload as { channel?: string; channelName?: string; text?: string };
    const dry = staged.preview.dryRun;
    return (
      <PanelFrame
        label="Confirm the feedback post"
        context={context_line}
        title={dry ? 'Dry run: check the payload' : `Post to ${where ?? 'the feedback channel'}?`}
        sub={dryLine}
        primary={{ id: 'send', label: busy ? 'Sending…' : dry ? 'Show payload & copy' : `Post to ${where ?? 'channel'}`, icon: dry ? 'copy' : 'send', loading: busy, disabled: busy, run: () => void send() }}
        quiet={
          <QuietAction icon="edit" onClick={() => setStep('review')} disabled={busy} data-feedback-edit>
            Back to edit
          </QuietAction>
        }
        data-feedback-step={step}
      >
        <PanelSection title="Posts to">
          <Facts
            rows={[
              ['Channel', <span key="c" data-feedback-target={p.channel}>{`${p.channelName || p.channel} (${p.channel})`}</span>],
              ['As', 'You, one top-level message'],
              ['Mode', dry ? 'Dry run: nothing leaves the machine' : 'Live post'],
            ]}
          />
        </PanelSection>
        <PanelSection title="Exactly this text">
          <pre className="max-h-[40vh] overflow-auto rounded-md border border-line bg-surface-sunken p-3 font-mono text-caption whitespace-pre-wrap text-fg" data-feedback-preview>
            {p.text}
          </pre>
        </PanelSection>
        <details className="text-caption text-muted">
          <summary className="cursor-pointer">View payload</summary>
          <pre className="mt-2 overflow-auto rounded-md bg-surface-sunken p-3 font-mono whitespace-pre-wrap text-fg">{JSON.stringify(staged.preview.payload, null, 2)}</pre>
        </details>
        {errorLine}
      </PanelFrame>
    );
  }

  // ── done ────────────────────────────────────────────────────────────────────────────────
  const payload = sent?.payload ?? {};
  return (
    <PanelFrame
      label="Feedback sent"
      context={context_line}
      title={sent?.dryRun ? 'Dry run: nothing was posted' : posted?.status === 'sending' ? `Queued for ${where ?? 'the feedback channel'}` : posted?.status === 'failed' ? `Couldn't post to ${where ?? 'the feedback channel'}` : `Sent to ${where ?? 'the feedback channel'}`}
      sub={
        sent?.dryRun
          ? `${copied ? 'The message is on your clipboard: paste it into ' : 'Copy the message below and paste it into '}${where ?? 'the feedback channel'}. The report stays in the Outbox, where Apply posts it once dry run is off.`
          : `${posted?.attempts.at(-1)?.detail ?? sent?.attempt.detail ?? 'Posting it now.'} It is listed in the Outbox under ${posted?.status === 'failed' ? 'Failed' : 'Sent'}.`
      }
      primary={{ id: 'another', label: 'Report another', icon: 'add', run: reset }}
      quiet={
        <span className="inline-flex items-center gap-3">
          {posted?.resultUrl ? (
            <a href={posted.resultUrl} target="_blank" rel="noopener noreferrer" className="text-caption font-bold text-link" data-feedback-post-link>
              Open the post ↗
            </a>
          ) : null}
          <AppLink href={sent?.draft.id ? `/outbox?draft=${encodeURIComponent(sent.draft.id)}` : '/outbox'} className="text-caption font-bold text-link">
            Open the Outbox
          </AppLink>
        </span>
      }
      data-feedback-step="done"
      data-feedback-dry-run={sent?.dryRun ? 'true' : 'false'}
    >
      <PanelSection title={sent?.dryRun ? 'The payload (not sent)' : 'What was sent'} action={<CopyButton text={String(payload.text ?? '')} label="Copy message" />}>
        <pre className="max-h-[50vh] overflow-auto rounded-md border border-line bg-surface-sunken p-3 font-mono text-caption whitespace-pre-wrap text-fg" data-feedback-payload>
          {JSON.stringify(payload, null, 2)}
        </pre>
      </PanelSection>
      {sent && !sent.dryRun ? (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            void qc.invalidateQueries({ queryKey: ['outbox'] });
            void live.refetch();
          }}
        >
          Refresh status
        </Button>
      ) : null}
    </PanelFrame>
  );
}
